// pages/api/manual-enrich.js
import { supabaseAdmin } from '../../lib/supabaseAdminClient';
import { enrichFromDomain } from '../../lib/enrichFromDomain';
import { scrapeWebsiteData } from '../../lib/scrapeWebsite';
import { upsertDomainEnrichmentCache } from '../../lib/upsertDomainEnrichmentCache';
import punycode from 'node:punycode';

// --- helpers ---------------------------------------------------------------
function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}
const validNum = (v) => typeof v === 'number' && !Number.isNaN(v);

function hostFromUrl(u) {
  try { return new URL(u).hostname?.toLowerCase() || null; } catch { return null; }
}

// service-subdomeinen wegstrippen
const SERVICE_LABELS = /^(mail|vpn|smtp|webmail|pop3|imap|owa|remote|ns\d*|mx\d*|cpanel|webdisk|autodiscover|server|host|exchange|secure|ssl|admin|gateway|proxy|support|login|portal|test|staging|dev)\./i;
function stripSubdomain(domain) {
  if (!domain) return null;
  let d = String(domain).trim();
  d = d.replace(/^\*\.\s*/, '').replace(/\.$/, '');
  try { d = punycode.toASCII(d); } catch {}
  d = d.toLowerCase().replace(/_+/g, '-').replace(/\.+/g, '.');
  d = d.replace(SERVICE_LABELS, '').replace(/^www\./, '');
  return d;
}
function isLikelyDomain(s) {
  return typeof s === 'string' && s.includes('.') && !/\s/.test(s);
}
function cleanDomain(domain) {
  if (!domain) return null;
  let cleaned = stripSubdomain(domain);
  if (!cleaned) return null;
  cleaned = cleaned
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/^\.+/, '').replace(/\.+$/, '')
    .replace(/^-+/, '').replace(/-+$/, '');
  if (!cleaned.includes('.')) return null;
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned);
  const isIPv6 = /:/.test(cleaned);
  if (isIPv4 || isIPv6) return null;
  const labels = cleaned.split('.');
  if (labels.some(l => l.length === 0 || l.length > 63)) return null;
  if (labels.some(l => !/^[a-z0-9-]+$/.test(l))) return null;
  if (labels.some(l => l.startsWith('-') || l.endsWith('-'))) return null;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld)) return null;
  return cleaned;
}

function nameDomainAffinity(domain, name) {
  if (!domain || !name) return 0;
  const core = domain.split('.').slice(-2, -1)[0]?.replace(/-/g, '') || '';
  const slug = String(name).toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/\b(bv|b\.v\.|nv|n\.v\.|gmbh|ltd|limited|holding)\b/gi, ' ')
    .replace(/\s+/g, '')
    .trim();
  if (!core || !slug) return 0;
  if (core === slug) return 0.25;
  if (core.includes(slug) || slug.includes(core)) return 0.15;
  return 0;
}

async function fetchIpApi(ip) {
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}`);
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.includes('application/json')) return null;
    const json = await r.json();
    if (json.status !== 'success') return null;
    return json;
  } catch { return null; }
}

// --- handler ---------------------------------------------------------------
export default async function manualEnrichRunner(req, res) {
  // Sta zowel GET (query) als POST (json) toe
  const src = req.method === 'GET' ? (req.query || {}) : (req.body || {});
  const onlyIp = src.ip || null;
  const limit  = Number(src.limit) || 10;


  // Pak rijen die klaarstaan én ten minste een naam of domein hebben
  const query = supabaseAdmin
    .from('ipapi_cache')
    .select(`
      ip_address, manual_enrich,
      company_domain, company_name,
      confidence, confidence_reason,
      domain_address, domain_city, domain_country, domain_lat, domain_lon,
      phone, email, linkedin_url, facebook_url, instagram_url, twitter_url,
      meta_description, category,
      ip_city, ip_country, ip_postal_code, location
    `)
    .eq('manual_enrich', true)
    .or('company_domain.not.is.null,company_name.not.is.null')
    .limit(limit);

  if (onlyIp) query.eq('ip_address', onlyIp);

  const { data: rows, error } = await query;
  if (error) {
    console.error('❌ Supabase select error:', error);
    return res.status(500).json({ error: 'DB select error' });
  }
  if (!rows?.length) return res.status(200).json({ message: 'Niets te verrijken' });

  const processed = [];

  for (const row of rows) {
    const ip = row.ip_address;
    const seededName   = row.company_name || null;
    const seededDomain = cleanDomain(row.company_domain) || null;

    // 1) IP basisdata (voor bias + IP-velden)
    const ipapi = await fetchIpApi(ip);
    const ip_city         = ipapi?.city ?? row.ip_city ?? null;
    const ip_country      = ipapi?.country ?? row.ip_country ?? null;
    const ip_postal_code  = ipapi?.zip ?? row.ip_postal_code ?? null;
    let   location        = row.location || null;
    if (!location) {
      if (ip_city && ip_country) {
        location = ipapi?.regionName ? `${ip_city}, ${ipapi.regionName}` : ip_city;
      } else if (ip_country) {
        location = ip_country;
      }
    }

    // 2) Unified Maps-enrichment: zoek met domein óf naam
    const seedQuery = seededDomain || seededName;
    let mapEnrich = null;
    try {
      mapEnrich = seedQuery
        ? await enrichFromDomain(seedQuery, ipapi?.lat ?? null, ipapi?.lon ?? null)
        : null;
    } catch (e) {
      console.warn(`⚠️ enrichFromDomain() error voor "${seedQuery}":`, e.message);
    }

    // 3) Domein bepalen:
    //    - Als Maps website heeft → hostname
    //    - Anders seededDomain
    //    - Anders, als seed er uitziet als domein, neem die
    let domainFromMaps = mapEnrich?.website ? cleanDomain(hostFromUrl(mapEnrich.website)) : null;
    let company_domain = domainFromMaps || seededDomain || (isLikelyDomain(seedQuery) ? cleanDomain(seedQuery) : null);

    if (!company_domain) {
      // Geen domein → laat vlag staan zodat jij later een domein kunt bijzetten
      processed.push({ ip, status: 'no-domain-found', seedQuery });
      continue;
    }

    // 4) Scrape
    let scraped = null;
    try {
      scraped = await scrapeWebsiteData(company_domain);
      await supabaseAdmin.from('scrape_log').insert({
        domain: company_domain,
        success: !!scraped && Object.values(scraped).some(Boolean),
        result: scraped || null,
        error_message: (!scraped || !Object.values(scraped).some(Boolean)) ? 'Geen bruikbare data' : null
      });
    } catch (e) {
      await supabaseAdmin.from('scrape_log').insert({
        domain: company_domain,
        success: false,
        error_message: e.message || 'Onbekende scrapingfout'
      });
    }

    // 5) Merge velden (Maps geeft adres/coords/categorie/naam)
    const lat = mapEnrich?.lat ?? row.domain_lat ?? null;
    const lon = mapEnrich?.lon ?? row.domain_lon ?? null;
    const latOk = validNum(lat);
    const lonOk = validNum(lon);

    const company_name   = mapEnrich?.name || row.company_name || seededName || null;
    const domain_address = mapEnrich?.domain_address || row.domain_address || null;
    const domain_city    = mapEnrich?.domain_city || row.domain_city || null;
    const domain_country = mapEnrich?.domain_country || row.domain_country || null;
    const category       = mapEnrich?.category || row.category || null;

    const phone            = scraped?.phone ?? row.phone ?? null;
    const email            = scraped?.email ?? row.email ?? null;
    const linkedin_url     = scraped?.linkedin_url ?? row.linkedin_url ?? null;
    const facebook_url     = scraped?.facebook_url ?? row.facebook_url ?? null;
    const instagram_url    = scraped?.instagram_url ?? row.instagram_url ?? null;
    const twitter_url      = scraped?.twitter_url ?? row.twitter_url ?? null;
    const meta_description = scraped?.meta_description ?? row.meta_description ?? null;

    // 6) Confidence (nooit omlaag)
    const baseConf = mapEnrich?.confidence ?? (company_domain ? 0.65 : 0.5);
    const affBoost = nameDomainAffinity(company_domain, company_name);
    const computed = Math.min(0.95, baseConf + affBoost);

    const finalConfidence =
      (typeof row.confidence === 'number' && !Number.isNaN(row.confidence))
        ? Math.max(row.confidence, computed)
        : computed;

    const confidence_reason =
      mapEnrich?.confidence_reason ||
      (seededName && !seededDomain ? 'Manual name → Google Maps' : 'Manual enrichment');

    // 7) ip_enrichment_cache updaten voor hergebruik
    try {
      await upsertDomainEnrichmentCache(company_domain, {
        domain_lat: latOk && lonOk ? lat : null,
        domain_lon: latOk && lonOk ? lon : null,
        radius: null,
        maps_result: mapEnrich?.raw ?? null,
        confidence: finalConfidence,
        confidence_reason,
        phone, email, linkedin_url, facebook_url, instagram_url, twitter_url, meta_description
      });
    } catch (e) {
      console.warn('⚠️ upsertDomainEnrichmentCache() error:', e.message);
    }

    // 8) ipapi_cache bijwerken (en manual_enrich uit zetten)
    const cachePayload = pruneEmpty({
      ip_address: ip,
      company_domain,
      company_name,
      location,
      ip_postal_code,
      ip_city,
      ip_country,

      enriched_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      enrichment_source: (seededName && !seededDomain) ? 'manual_enrich_gmaps_name' : 'manual_enrich',
      confidence: finalConfidence,
      confidence_reason,

      domain_address,
      domain_city,
      domain_country,
      domain_lat: (latOk && lonOk) ? lat : undefined,
      domain_lon: (latOk && lonOk) ? lon : undefined,

      phone,
      email,
      linkedin_url,
      facebook_url,
      instagram_url,
      twitter_url,
      meta_description,
      category,

      manual_enrich: false
    });

    const { error: updErr } = await supabaseAdmin
      .from('ipapi_cache')
      .update(cachePayload)
      .eq('ip_address', ip);

    if (updErr) {
      console.error('❌ Update ipapi_cache error:', updErr);
      processed.push({ ip, status: 'update-failed', error: updErr.message });
      continue;
    }

    processed.push({ ip, status: 'ok', domain: company_domain });
  }

  return res.status(200).json({ message: 'Handmatige enrichment uitgevoerd', processed });
}
