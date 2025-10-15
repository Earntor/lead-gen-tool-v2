// pages/api/manual-enrich.js
import { supabaseAdmin } from '../../lib/supabaseAdminClient';
import { enrichFromDomain } from '../../lib/enrichFromDomain';
import { scrapeWebsiteData } from '../../lib/scrapeWebsite';
import { scrapePeopleForDomain } from '../../lib/peopleScraper'; // ✅ NIEUW

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

function normalizePhone(raw) {
  if (!raw) return null;
  let s = decodeMaybe(String(raw)).replace(/^tel:/i, '').trim();
  if (s.startsWith('+')) return s.replace(/[^\d+]+/g, '');
  if (s.startsWith('00')) return `+${s.slice(2)}`.replace(/[^\d+]+/g, '');
  return s.replace(/[^\d]+/g, '');
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

// ==== Helpers voor people_cache upsert (zelfde logica als /api/people) ====

function isImproved(oldRow, neu) {
  if (!oldRow) return true;
  if ((neu.people_count || 0) > (oldRow.people_count || 0)) return true;
  if ((neu.source_quality || 0) > (oldRow.source_quality || 0)) return true;
  if (neu.team_page_hash && neu.team_page_hash !== oldRow.team_page_hash && (neu.people_count || 0) >= 1) return true;
  const order = { empty:0, error:1, blocked:2, no_team:3, stale:4, fresh:5 };
  if ((order[oldRow.status] ?? 0) < (order[neu.status] ?? 0)) return true;
  return false;
}

function nextAllowedOnSuccess(ttlDays) {
  const d = new Date();
  d.setDate(d.getDate() + (ttlDays || 14));
  return d.toISOString();
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
      // 1) Locatiehint (alleen voor Maps keus)
      let ipLat = null, ipLon = null;
      try {
        const ipapiRes = await fetch(`http://ip-api.com/json/${ip}`);
        const ipapi = ipapiRes.ok ? await ipapiRes.json() : null;
        if (ipapi && ipapi.status === 'success') {
          ipLat = typeof ipapi.lat === 'number' ? ipapi.lat : null;
          ipLon = typeof ipapi.lon === 'number' ? ipapi.lon : null;
        }
      } catch {}

      // 2) Geen domein maar wel naam → via Maps website → domein
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

      // 3) Maps enrichment met domein (of fallback)
      let maps = null;
      if (domain) {
        maps = await enrichFromDomain(domain, ipLat, ipLon);
      } else if (mapsFromName) {
        maps = mapsFromName;
      }

      // 4) Scrape website (home) voor bedrijfsdata
      let scraped = null;
      if (domain) {
        scraped = await scrapeWebsiteData(domain);
      }

      // 5) Merge bedrijfsdata en telefoon-normalisatie
      const phoneRaw = scraped?.phone || maps?.phone || null;
      const phone = normalizePhone(phoneRaw);

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

      // 6) ✅ TEAMS SCRAPEN & UPDATEN VAN people_cache
let peopleResult = null;
let peopleOutcome = null;
let upsertedPeople = false;
let peopleCount = 0;
let scrapedPeopleNow = false; // <-- moet buiten de if (domain) leven


      if (domain) {
        try {
          peopleResult = await scrapePeopleForDomain(domain);

          // Bestaand cache-record ophalen (kan ontbreken)
          let { data: existing, error: selErr } = await supabaseAdmin
            .from('people_cache')
            .select('*')
            .eq('company_domain', domain)
            .single();

          if (selErr && selErr.code === 'PGRST116') {
            // nieuw record initialiseren
            const init = {
              company_domain: domain,
              status: 'empty',
              people: [],
              people_count: 0,
              ttl_days: 14,
              next_allowed_crawl_at: new Date(0).toISOString(),
              processing: false,
            };
            const { data: inserted } = await supabaseAdmin
              .from('people_cache')
              .insert(init)
              .select('*')
              .single();
            existing = inserted;
          } else if (selErr) {
            console.error('people_cache select error:', selErr);
          }

          if (peopleResult?.accept) {
            // Succes — fresh
            // Algemene contactgegevens (company-level) alvast klaarzetten als fallback
const companyEmail = scraped?.email || null;     // vaak via scrapeWebsiteData
const companyPhone = phone || null;              // 'phone' heb je hierboven al genormaliseerd

// Personen verrijken met fallback waar nodig
const enrichedPeople = (peopleResult.people || []).map(p => {
  const hasEmail = !!(p.email && String(p.email).trim());
  const hasPhone = !!(p.phone && String(p.phone).trim());

  // ⬇️ Gate: geen fallback voor generieke/team-rollen
  const isGenericRole = (p.role_title || '').match(/vacature|recruit|recruitment|hr|human\s*resources|helpdesk|servicedesk|service\s*desk|support|supportdesk|klantenservice|customer\s*service/i);

  const finalEmail = hasEmail ? p.email : (isGenericRole ? null : (companyEmail || null));
  const finalPhone = hasPhone ? p.phone : (isGenericRole ? null : (companyPhone || null));

  return {
    ...p,
    email: finalEmail,
    phone: finalPhone,
    contact_email_is_fallback: !hasEmail && !!finalEmail,
    contact_phone_is_fallback: !hasPhone && !!finalPhone,
  };
});


peopleOutcome = {
  status: 'fresh',
  people: enrichedPeople,
  people_count: enrichedPeople.length,           // tel ná fallback
  team_page_url: peopleResult.team_page_url,
  team_page_hash: peopleResult.team_page_hash,
  team_page_etag: peopleResult.etag || null,
  team_page_last_modified: peopleResult.last_modified
    ? new Date(peopleResult.last_modified).toISOString()
    : null,
  evidence_urls: peopleResult.evidence_urls || [],
  detection_reason: peopleResult.detection_reason,
  source_quality: peopleResult.source_quality || 0,
  last_verified: new Date().toISOString(),
  retry_count: 0,
  next_allowed_crawl_at: nextAllowedOnSuccess(existing?.ttl_days || 14),
  last_error_code: null,
  last_error_at: null,
  render_state: 'not_needed',
};
          } else {
  // Niet geaccepteerd → onderscheid 'blocked' vs 'no_team' en bewaar ALTIJD URL + evidence
  const isBlocked = (peopleResult?.reason === 'blocked');

  // Cooldown: korter bij blokkade (6 uur), anders normale TTL
  const nextAt = isBlocked
    ? (() => { const d = new Date(); d.setHours(d.getHours() + 6); return d.toISOString(); })()
    : nextAllowedOnSuccess(existing?.ttl_days || 14);

  peopleOutcome = {
    status: isBlocked ? 'blocked' : 'no_team',
    people: existing?.people || [],
    people_count: existing?.people_count || 0,
    team_page_url: peopleResult?.url || existing?.team_page_url || null, // ✅ URL invullen
    team_page_hash: peopleResult?.team_page_hash || existing?.team_page_hash || null,
    team_page_etag: peopleResult?.etag || existing?.team_page_etag || null,
    team_page_last_modified: peopleResult?.last_modified
      ? new Date(peopleResult.last_modified).toISOString()
      : existing?.team_page_last_modified || null,
    evidence_urls: Array.from(new Set([                    // ✅ evidence samenvoegen
      ...(existing?.evidence_urls || []),
      ...((peopleResult?.evidence_urls || []))
    ])),
    detection_reason: peopleResult?.reason || 'no-accept',
    source_quality: Math.max(existing?.source_quality || 0, peopleResult?.source_quality || 0),
    last_verified: new Date().toISOString(),
    retry_count: (existing?.retry_count || 0) + 1,
    next_allowed_crawl_at: nextAt,
    last_error_code: isBlocked ? 'blocked' : null,
    last_error_at: isBlocked ? new Date().toISOString() : null,
    render_state: isBlocked ? 'unknown' : 'needed',
  };
}


          // Upsert alleen als beter (of als er nog niets is)
          const improved = isImproved(existing, peopleOutcome);

// ✅ Altijd URL/evidence samenvoegen
const mergedEvidence = Array.from(new Set([
  ...(existing?.evidence_urls || []),
  ...((peopleOutcome?.evidence_urls || [])),
  ...(peopleOutcome?.team_page_url ? [peopleOutcome.team_page_url] : [])
]));

// Basisonderdelen die we ALTIJD bijwerken
const baseAlways = {
  team_page_url: peopleOutcome?.team_page_url || existing?.team_page_url || null,
  team_page_hash: peopleOutcome?.team_page_hash || existing?.team_page_hash || null,
  team_page_etag: peopleOutcome?.team_page_etag || existing?.team_page_etag || null,
  team_page_last_modified: peopleOutcome?.team_page_last_modified || existing?.team_page_last_modified || null,
  evidence_urls: mergedEvidence,
  detection_reason: peopleOutcome?.detection_reason || existing?.detection_reason || null,
  source_quality: Math.max(existing?.source_quality || 0, peopleOutcome?.source_quality || 0),
  last_verified: peopleOutcome?.last_verified || new Date().toISOString(),
};

const patch = {
  ...(improved ? {
    status: peopleOutcome.status,
    people: peopleOutcome.people,
    people_count: peopleOutcome.people_count,
  } : {
    // status/people ongemoeid laten wanneer het niet beter is
  }),
  ...baseAlways,
  retry_count: peopleOutcome.retry_count,
  next_allowed_crawl_at: peopleOutcome.next_allowed_crawl_at,
  last_error_code: peopleOutcome.last_error_code,
  last_error_at: peopleOutcome.last_error_at,
  render_state: peopleOutcome.render_state || existing?.render_state || 'unknown',
  processing: false,
};

// -- write the patch to DB
await supabaseAdmin
  .from('people_cache')
  .update(patch)
  .eq('company_domain', domain);

// -- set flags from local outcome (not from DB readback)
upsertedPeople = !!improved;

scrapedPeopleNow = !!(
  peopleOutcome &&
  peopleOutcome.status === 'fresh' &&
  (peopleOutcome.people_count || 0) > 0
);

// choose peopleCount for response
peopleCount = improved
  ? (peopleOutcome?.people_count || 0)
  : (existing?.people_count || 0);


        } catch (pe) {
          console.error(`❌ People scrape/update error for ${domain}:`, pe);
        }
      }

      // ✅ Bepaal "scraped people now" op basis van wat we echt hebben weggeschreven
// ✅ Bepaal "scraped people now" vanuit de DB (waarheid)
results.push({
  ip_address: ip,
  ok: true,
  derived_domain_from_name: usedNameLookup,
  used_domain: domain || null,
  maps_found: !!maps,
  scraped: !!scraped,
  people_scraped: scrapedPeopleNow,   // ⬅️ uit lokale outcome
  people_upserted: upsertedPeople,    // ⬅️ true alleen bij echte improvement
  people_count: peopleCount
});



    } catch (e) {
      console.error(`❌ Manual enrich fout voor ${ip}:`, e);
      results.push({ ip_address: ip, ok: false, error: e.message });
    }
  }

  return res.status(200).json({
    message: 'Handmatige enrichment uitgevoerd (incl. teamleden in people_cache)',
    processed: results
  });
}
