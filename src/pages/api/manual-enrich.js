// pages/api/manual-enrich.js
import { supabaseAdmin } from '../../lib/supabaseAdminClient';
import { enrichFromDomain } from '../../lib/enrichFromDomain';
import { scrapeWebsiteData } from '../../lib/scrapeWebsite';

function extractDomainFromUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u.startsWith('http') ? u : `https://${u}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function decodeMaybe(s) {
  if (!s) return s;
  try { return decodeURIComponent(String(s)); } catch { return s; }
}


function normalizePhone(raw, opts = {}) {
  // opts = { mapsCountryCode: 'NL' | 'BE' | ..., domain: 'example.nl' }
  if (!raw) return null;
  let s = decodeMaybe(String(raw)).replace(/^tel:/i, '').trim();

  // Al internationale vorm? Dan alleen opschonen
  if (s.startsWith('+')) {
    return s.replace(/[^\d+]+/g, '');
  }
  if (s.startsWith('00')) {
    // 00 → + en opschonen
    s = `+${s.slice(2)}`;
    return s.replace(/[^\d+]+/g, '');
  }

  // Verder opschonen, maar '+' kunnen we nu niet meer hebben
  s = s.replace(/[^\d]+/g, '');

  // Geen betrouwbare hint → laat lokaal nummer schoon terug
  return s;
}

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

export default async function manualEnrich(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = Number(req.query.limit ?? req.body?.limit ?? 10) || 10;

  const { data: rows, error } = await supabaseAdmin
    .from('ipapi_cache')
    .select('ip_address, company_name, company_domain')
    .eq('manual_enrich', true)
    .limit(limit);

  if (error) {
    console.error('❌ Supabase select error:', error);
    return res.status(500).json({ error: 'DB select failed' });
  }
  if (!rows || rows.length === 0) {
    return res.status(200).json({ message: 'Niets te verrijken' });
  }

  const results = [];

  for (const row of rows) {
    const ip = row.ip_address;
    let domain = row.company_domain || null;
    let usedNameLookup = false;

    try {
      // 1) We gebruiken IP alleen voor lat/lon keus in Maps (niet voor telefoon)
      let ipLat = null, ipLon = null;
      try {
        const ipapiRes = await fetch(`http://ip-api.com/json/${ip}`);
        const ipapi = ipapiRes.ok ? await ipapiRes.json() : null;
        if (ipapi && ipapi.status === 'success') {
          ipLat = typeof ipapi.lat === 'number' ? ipapi.lat : null;
          ipLon = typeof ipapi.lon === 'number' ? ipapi.lon : null;
        }
      } catch {}

      // 2) Geen domein maar wél naam? → via Maps website → domein
      let mapsFromName = null;
      if (!domain && row.company_name) {
        mapsFromName = await enrichFromDomain(row.company_name, ipLat, ipLon);
        const fromWebsite = extractDomainFromUrl(mapsFromName?.website);
        if (fromWebsite) {
          domain = fromWebsite;
          usedNameLookup = true;
          await supabaseAdmin
            .from('ipapi_cache')
            .update({ company_domain: domain, last_updated: new Date().toISOString() })
            .eq('ip_address', ip);
        }
      }

      // 3) Maps enrichment met domein (of fallback naar mapsFromName)
      let maps = null;
      if (domain) {
        maps = await enrichFromDomain(domain, ipLat, ipLon);
      } else if (mapsFromName) {
        maps = mapsFromName;
      }

      // 4) Scrape website (alleen als we domein hebben)
      let scraped = null;
      if (domain) {
        scraped = await scrapeWebsiteData(domain);
      }

      // 5) Merge en telefoon-normalisatie ZONDER IP-land
      const phoneRaw = scraped?.phone || maps?.phone || null;
      const phone = normalizePhone(phoneRaw, {
        mapsCountryCode: maps?.domain_country_code || null,
        domain
      });

      const payload = pruneEmpty({
        company_name: row.company_name || maps?.name || null,
        company_domain: domain || null,

        domain_address: maps?.domain_address || null,
        domain_postal_code: maps?.domain_postal_code || null,
        domain_city: maps?.domain_city || null,
        domain_country: maps?.domain_country || null,
        domain_lat: typeof maps?.lat === 'number' ? maps.lat : null,
        domain_lon: typeof maps?.lon === 'number' ? maps.lon : null,
        category: maps?.category || null,

        phone,
        email: scraped?.email || null,
        linkedin_url: scraped?.linkedin_url || null,
        facebook_url: scraped?.facebook_url || null,
        instagram_url: scraped?.instagram_url || null,
        twitter_url: scraped?.twitter_url || null,
        meta_description: scraped?.meta_description || null,

        enrichment_source: maps ? 'google_maps' : (scraped ? 'website_scrape' : 'manual_enrich'),
        confidence: maps?.confidence ?? null,
        confidence_reason: maps?.confidence_reason ?? null,

        enriched_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      });

      await supabaseAdmin
        .from('ipapi_cache')
        .update({ ...payload, manual_enrich: false })
        .eq('ip_address', ip);

      results.push({
        ip_address: ip,
        ok: true,
        derived_domain_from_name: usedNameLookup,
        used_domain: domain || null,
        maps_found: !!maps,
        scraped: !!scraped
      });
    } catch (e) {
      console.error(`❌ Manual enrich fout voor ${ip}:`, e);
      results.push({ ip_address: ip, ok: false, error: e.message });
    }
  }

  return res.status(200).json({
    message: 'Handmatige enrichment uitgevoerd (zonder IP-land voor telefoon)',
    processed: results
  });
}
