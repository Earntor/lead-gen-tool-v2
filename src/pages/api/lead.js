import { supabaseAdmin } from '../../lib/supabaseAdminClient';
import { enrichFromDomain } from '../../lib/enrichFromDomain';
import { scrapeWebsiteData } from '../../lib/scrapeWebsite';
import { scoreReverseDnsHostname, getConfidenceReason } from '../../lib/hostnameScoring';
import dns from 'node:dns/promises';
import { getTlsCertificateFromIp } from '../../lib/getTlsCertificateFromIp';
import { getDomainFromHttpIp } from '../../lib/fetchIpWebsite';
import { getFaviconHash } from '../../lib/faviconHash';
import { getLikelyDomainFromSignals } from '../../lib/getLikelyDomainFromSignals';
import { logDomainSignal } from '../../lib/logDomainSignal.js';
import { probeHostHeader } from '../../lib/probeHostHeader';
import { upsertDomainEnrichmentCache } from '../../lib/upsertDomainEnrichmentCache';
import punycode from 'node:punycode'; // voor IDN → ASCII normalisatie
// BEGIN PATCH: imports
import psl from 'psl';                         // eTLD+1 normalisatie
import tls from 'node:tls';                    // SNI probing
import { createRequire } from 'node:module';   // CJS import voor imghash
const require = createRequire(import.meta.url);
// END PATCH

export const config = { runtime: 'nodejs' };

// Verwijder null/undefined en lege strings uit een payload
function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

// Bekende consumenten-ISPs
const KNOWN_ISPS = [
  'Ziggo', 'KPN', 'T-Mobile', 'Vodafone', 'Tele2', 'Delta', 'Freedom Internet', 'Online.nl', 'Odido'
];

// Enrichment source gelijktrekken
const ENRICHMENT_SOURCES = {
  RDNS: 'reverse_dns',
  TLS: 'tls_cert',
  HTTP_FETCH: 'http_fetch',
  FAVICON: 'favicon_hash',
  HOST_HEADER: 'host_header',
  FINAL_LIKELY: 'final_likely',
  GMAPS: 'google_maps',
  SCRAPE: 'website_scrape',
  ISP_BASELINE: 'isp_baseline',
  IPAPI_BASELINE: 'ipapi_baseline',
  CACHE_REUSE: 'cache_reuse'
};

// confidence reason gelijktrekken
const CONFIDENCE_REASONS = {
  RDNS: 'Reverse DNS match',
  TLS: 'TLS-certificaat CN/SAN domeinextractie',
  HTTP_FETCH: 'HTTP fetch domeinextractie',
  FAVICON: 'Favicon hash match',
  HOST_HEADER: 'Host header probe match',
  FINAL_LIKELY: 'Gekozen op basis van gecombineerde signalen',
  GMAPS: 'Google Maps bedrijfsverrijking',
  SCRAPE: 'Website scraping',
  ISP_BASELINE: 'Baseline ISP-gegevens',
  IPAPI_BASELINE: 'Baseline IP-API-gegevens',
  CACHE_REUSE: 'Herbruikte domeinverrijking uit cache'
};


// Hostingproviders
const HOSTING_DOMAINS = [
  'sr-srv.net', 'dfn.nl', 'leaseweb.net', 'ovh.net', 'azure.com', 'amazonaws.com',
  'googleusercontent.com', 'linode.com', 'digitalocean.com', 'hetzner.de',
];

// Extra blacklist voor reverse DNS (consumenten en irrelevante domeinen)
const EXTRA_BLACKLIST_DOMAINS = [
  'kpn.net', 'ziggo.nl', 'glasoperator.nl', 't-mobilethuis.nl', 'chello.nl',
  'dynamic.upc.nl', 'vodafone.nl', 'versatel.nl', 'msn.com', 'akamaitechnologies.com',
  'telenet.be', 'myaisfibre.com', 'filterplatform.nl', 'xs4all.nl', 'home.nl',
  'weserve.nl', 'crawl.cloudflare.com', 'kabelnoord.net', 'googlebot.com','client.t-mobilethuis.nl', 'routit.net', 'starlinkisp.net', 'baremetal.scw.cloud','fbsv.net','sprious.com', 'your-server.de', 'vodafone.pt', 'ip.telfort.nl', 'amazonaws.com', 'dataproviderbot.com', 'apple.com', 'belgacom.be' 
];

async function logBlockedSignal({
  ip_address, domain, source, asname, reason, org_id, page_url, confidence, confidence_reason,
  ignore_type = 'blocked' // toegestaan: 'blocked','isp-info','isp','no-domain','low-confidence'
}) {
  const payload = {
    ip_address,
    as_name: asname || null,
    reason: reason || 'blacklisted in step',
    page_url: page_url || null,
    ignored_at: new Date().toISOString(),
    ignore_type,
    // Alles wat geen losse kolom heeft bewaren we in JSONB 'signals'
    signals: {
      blocked_domain: domain || null,
      blocked_source: source || null,
      org_id: org_id || null,
      confidence: (typeof confidence === 'number' && !Number.isNaN(confidence)) ? confidence : null,
      confidence_reason: (confidence_reason && confidence_reason.trim()) ? confidence_reason : null
    }
  };

  const { error } = await supabaseAdmin.from('ignored_ip_log').insert(payload);
  if (error) {
    console.error('❌ ignored_ip_log insert (blocked) faalde:', error.message, error.details || '');
  }
}



// Kleine helpers
const validNum = (v) => typeof v === 'number' && !Number.isNaN(v);

// Is een timestamp recent genoeg (default 72 uur)?
function isFreshEnough(ts, ttlHours = 72) {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) && (Date.now() - t) < ttlHours * 3600 * 1000;
}

// service-subdomeinen die we wegstrippen
const SERVICE_LABELS = /^(mail|vpn|smtp|webmail|pop3|imap|owa|remote|ns\d*|mx\d*|cpanel|webdisk|autodiscover|server|host|exchange|secure|ssl|admin|gateway|proxy|support|login|portal|test|staging|dev)\./i;

function stripSubdomain(domain) {
  if (!domain) return null;
  let d = String(domain).trim();

  // wildcard & trailing dot weg
  d = d.replace(/^\*\.\s*/, '').replace(/\.$/, '');

  // IDN → ASCII (punycode)
  try { d = punycode.toASCII(d); } catch { /* laat d zoals het is */ }

  d = d.toLowerCase();

  // normalize: underscores → hyphen, multiple dots → single dot
  d = d.replace(/_+/g, '-').replace(/\.+/g, '.');

  // service labels & www weghalen
  d = d.replace(SERVICE_LABELS, '').replace(/^www\./, '');

  return d;
}

// BEGIN PATCH: cleanAndValidateDomain met PSL/eTLD+1
function cleanAndValidateDomain(domain, source, asname, org_id, page_url, ip_address, confidence, confidence_reason) {
  if (!domain) return null;

  let cleaned = stripSubdomain(String(domain).trim());
  if (!cleaned) return null;

  cleaned = cleaned.replace(/[^a-z0-9.-]/g, '')
                   .replace(/^\.+/, '').replace(/\.+$/, '')
                   .replace(/^-+/, '').replace(/-+$/, '');
  if (!cleaned.includes('.')) return null;

  // geen IP-adressen
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned) || /:/.test(cleaned)) return null;

  // labels valideren
  const labels = cleaned.split('.');
  if (labels.some(l => l.length === 0 || l.length > 63)) return null;
  if (labels.some(l => !/^[a-z0-9-]+$/.test(l))) return null;
  if (labels.some(l => l.startsWith('-') || l.endsWith('-'))) return null;

  // PSL: reduceer naar eTLD+1 (acme.co.uk → acme.co.uk)
  const parsed = psl.parse(cleaned);
  if (!parsed || parsed.error || !parsed.domain) return null;
  cleaned = parsed.domain.toLowerCase();

  // blacklist/hosting
  const endsWithDomain = (host, tail) => host === tail || host.endsWith(`.${tail}`);
  const isBlocked =
    HOSTING_DOMAINS.some(dom => endsWithDomain(cleaned, dom)) ||
    EXTRA_BLACKLIST_DOMAINS.some(dom => endsWithDomain(cleaned, dom));

  if (isBlocked) {
    const safeConfidence =
      (typeof confidence === 'number' && !Number.isNaN(confidence)) ? confidence : 0.3;
    const safeReason =
      (confidence_reason && confidence_reason.trim()) ? confidence_reason : CONFIDENCE_REASONS.IPAPI_BASELINE;

    console.log(`⛔ Geblokkeerd domein (${source}): ${cleaned}`);
    logBlockedSignal({
      ip_address, domain: cleaned, source, asname,
      reason: 'blacklisted domain in cleanup', org_id, page_url,
      confidence: safeConfidence, confidence_reason: safeReason,
      ignore_type: 'blocked'
    });
    return null;
  }
  return cleaned;
}
// END PATCH




async function calculateConfidenceByFrequency(ip, domain) {
  const { data, error } = await supabaseAdmin
    .from('rdns_log')
    .select('*')
    .eq('ip_address', ip)
    .order('checked_at', { ascending: false })
    .limit(20); // laatste 20 logs

  if (error || !data) return null;

  const matching = data.filter(log => log.extracted_domain === domain);
  const frequency = matching.length / data.length;

  if (frequency >= 0.6 && data.length >= 5) {
    return {
      confidence: 0.85,
      reason: `frequency-based (${matching.length} / ${data.length})`
    };
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    ip_address,
    org_id,
    page_url,
    anon_id,
    referrer,
    utm_source,
    utm_medium,
    utm_campaign,
    duration_seconds,
    site_id
  } = req.body;

  // ⬇️ Globale IP-API velden die we later invullen
let ip_country = null;
let ip_city = null;
let ip_postal_code = null;
let location = null;


// Queue-status bijwerken voor alle pending jobs van deze bezoeker (ip+site)
const markQueue = async (status, reason) => {
  try {
    await supabaseAdmin
      .from('enrichment_queue')
      .update({
        status,
        updated_at: new Date().toISOString(),
        error_text: reason || null
      })
      .eq('ip_address', ip_address)
      .eq('site_id', site_id)
      .eq('status', 'pending');
  } catch (e) {
    console.warn('⚠️ queue status update faalde:', e.message);
  }
};


  try {
  const url = new URL(page_url);
  if (url.hostname.endsWith("vercel.app")) {
  console.log("⛔️ dashboard-bezoek gedetecteerd, wordt niet opgeslagen:", page_url);
  await markQueue('skipped', 'skipped: dashboard visit');
  return res.status(200).json({ ignored: true, reason: "dashboard visit" });
}

} catch (e) {
  console.warn("⚠️ Ongeldige page_url ontvangen, maar enrichment gaat door:", page_url);
  // ⚠️ Geen return hier – laat de enrichment gewoon doorlopen
}

// ⏳ Cooldown: recent mislukte verrijking? Sla 6 uur over
try {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // 6 uur terug
  const { data: recentFail } = await supabaseAdmin
    .from('ignored_ip_log')
    .select('id')
    .eq('ip_address', ip_address)
    .in('ignore_type', ['no-domain','low-confidence'])
    .gte('ignored_at', since)
    .limit(1);

  if (recentFail?.length) {
    await markQueue('skipped', 'skipped: recent failure cooldown');
    return res.status(200).json({ ignored: true, reason: 'recent failure cooldown' });
  }
} catch (e) {
  console.warn('⚠️ cooldown check faalde:', e.message);
}


  try {
    console.log('--- API LEAD DEBUG ---');
    console.log('Request body:', { ip_address, org_id, page_url });

    const { data: cached } = await supabaseAdmin
      .from('ipapi_cache')
      .select('*')
      .eq('ip_address', ip_address)
      .single();

    let ipData = cached;

// 🔎 Nieuwe, duidelijke checks op wat er in cache zit
const cachedHasDomain    = !!cached?.company_domain;
const cachedHasProfile   = !!(cached?.company_name || cached?.meta_description || cached?.category);
const cachedHasContacts  = !!(cached?.phone || cached?.email || cached?.linkedin_url || cached?.facebook_url || cached?.instagram_url || cached?.twitter_url);
const cachedHasAddr      = !!(cached?.domain_address || cached?.domain_city || cached?.domain_country);
const cachedHasConfidence= (cached?.confidence != null) && !Number.isNaN(Number(cached.confidence));
const cachedIsFresh      = isFreshEnough(cached?.last_updated ?? cached?.enriched_at, 72); // 72u TTL
const manualLock         = cached?.manual_enrich === true; // respecteer handmatig verrijkte profielen

// 🔒 Manual lock actief? Niet verrijken en niets overschrijven.
if (cached && manualLock) {
  await markQueue('done', 'cache hit (manual lock)');
  return res.status(200).json({
    success: true,
    mode: 'cache_hit_locked',
    company_domain: cached.company_domain ?? null,
    company_name:   cached.company_name ?? null,
    confidence:     cached.confidence ?? null
  });
}

// 🧠 Alleen verrijken als het echt nodig is
const needsDomainEnrichment =
  !cached
  || !cachedIsFresh
  || !cachedHasDomain                  // ← BELANGRIJK: zonder domein altijd verrijken
  || cached?.company_name === 'Testbedrijf'
  || (cachedHasDomain && (
       !cachedHasConfidence
       || !cachedHasAddr
       || !cachedHasContacts
       || !cachedHasProfile
       || !cached?.rdns_hostname
     ));

// ⚡ Early return bij verse, complete cache (scheelt kosten & tijd)
if (cached && !needsDomainEnrichment && !manualLock) {
  await markQueue('done', 'cache hit (fresh)');
  return res.status(200).json({
    success: true,
    mode: 'cache_hit',
    company_domain: cached.company_domain ?? null,
    company_name:   cached.company_name ?? null,
    confidence:     cached.confidence ?? null
  });
}

    if (!cached || needsDomainEnrichment) {
      const ipapiRes = await fetch(`http://ip-api.com/json/${ip_address}`);
      const contentType = ipapiRes.headers.get("content-type");

      if (!ipapiRes.ok || !contentType?.includes("application/json")) {
        const fallbackText = await ipapiRes.text();
        console.error("❌ IP-API gaf geen JSON terug:", fallbackText.slice(0, 300));
        return res.status(500).json({ error: 'IP-API gaf geen JSON terug' });
      }

      const ipapi = await ipapiRes.json();

      if (ipapi.status !== 'success') {
        throw new Error(`IP-API error: ${ipapi.message || 'onbekende fout'}`);
      }

ip_country = ipapi.country || null;
ip_city = ipapi.city || null;
ip_postal_code = ipapi.zip || null;

// Consistente location opbouw
location = null;


if (ip_city && ip_country) {
  location = ipapi.regionName ? `${ip_city}, ${ipapi.regionName}` : ip_city;
} else if (ip_country) {
  location = ip_country;
}

// Als location bestaat maar city/country niet, vul ze alsnog afgeleid
if (location && (!ip_city || !ip_country)) {
  if (!ip_city && ipapi.city) ip_city = ipapi.city;
  if (!ip_country && ipapi.country) ip_country = ipapi.country;
}

// Als city/country leeg zijn én geen IP-data → alles null
if (!ip_city && !ip_country) {
  location = null;
}


const asname = String(ipapi.as || ipapi.asname || ipapi.org || '');
const isISP = KNOWN_ISPS.some(isp => asname.toLowerCase().includes(isp.toLowerCase()));


      if (isISP) {
        console.log('⚠️ Bekende ISP gedetecteerd:', asname);
        await supabaseAdmin.from('ignored_ip_log').insert({
  ip_address,
  as_name: asname,
  reason: 'known ISP (not blocking)',
  ignored_at: new Date().toISOString(),
  ignore_type: 'isp-info' // ✅ duidelijk dat dit informatief is
});
      }

      let company_name = null;
      let company_domain = null;
      let domainSignals = [];
      let enrichment_source = null;
      let confidence = null;
      let confidence_reason = null;
      let reverseDnsDomain = null;

      let domain_address = null;
      let domain_postal_code = null;
      let domain_city = null;
      let domain_country = null;
      let domain_lat = null;
      let domain_lon = null;

      let phone = null;
      let email = null;
      let linkedin_url = null;
      let facebook_url = null;
      let instagram_url = null;
      let twitter_url = null;
      let meta_description = null;
      let category = null;

      // 🔁 Stap 2 – Reverse DNS → SIGNAL
      try {
        const hostnames = await dns.reverse(ip_address);
        console.log('🔍 Alle gevonden hostnames:', hostnames);

        let used = false;

        for (const hostname of hostnames) {
          const lowerHost = hostname.toLowerCase();
          const blacklistKeywords = ['dynamic', 'client', 'customer', 'dsl', 'broadband', 'home', 'pool', 'ip'];

        const hasBlacklisted = blacklistKeywords.some(k => lowerHost.includes(k));
        if (hasBlacklisted) continue;

const extracted = cleanAndValidateDomain(
  hostname,
  ENRICHMENT_SOURCES.RDNS,
  asname,
  org_id,
  page_url,
  ip_address,
  confidence,
  confidence_reason
);

if (!extracted) continue;

        const enrichmentStub = {
          domain: extracted,
          address: null,
          city: null,
          postal_code: null,
          phone: null
        };

        // BEGIN PATCH: RDNS scoring + forward-resolve check
let score = scoreReverseDnsHostname(hostname, { domain: extracted });
let reason = getConfidenceReason(score);

try {
  const forwardsA = await dns.resolve(extracted);
  const forwards = (forwardsA || []).map(String);
  const match = forwards.includes(ip_address);
  if (match) { score = Math.max(score, 0.7); reason += ' + forward-resolve match'; }
  else       { score = Math.max(0, score - 0.05); reason += ' + no forward-resolve'; }
} catch {
  score = Math.max(0, score - 0.05);
  reason += ' + forward-resolve failed';
}

if (extracted === 'moreketing.nl') {
  score = 0.95;
  reason = 'Whitelisted testdomein';
}
// END PATCH


        const threshold = 0.5;
        if (score < threshold) {
          console.log(`⛔ Confidence te laag (${score}) — wordt genegeerd`);
          continue;
        }

        const signal = await logDomainSignal({
          ip_address,
          domain: extracted,
          source: ENRICHMENT_SOURCES.RDNS,
          confidence: score,
          confidence_reason: reason
        });

        if (signal) {
domainSignals.push(signal);
          company_domain = extracted; // al gevalideerd door cleanAndValidateDomain

          enrichment_source = ENRICHMENT_SOURCES.RDNS;
          confidence = score;
          confidence_reason = reason;
          reverseDnsDomain = hostname;
          used = true;
          break;
        }
      }

      await supabaseAdmin.from('rdns_log').insert({
        ip_address,
        raw_hostnames: hostnames,
        extracted_domain: used ? company_domain : null,
        used,
        enrichment_source: used ? enrichment_source : null,
        confidence: used ? confidence : null,
        confidence_reason: used ? confidence_reason : null
      });
    } catch (e) {
      console.warn('⚠️ Reverse DNS lookup failed:', e.message);
      await supabaseAdmin.from('rdns_log').insert({
        ip_address,
        raw_hostnames: [],
        extracted_domain: null,
        used: false,
        enrichment_source: null,
        confidence: null,
        confidence_reason: null
      });
    }

// 🔐 Stap 3 – TLS-certificaatinspectie → SIGNAL (audit-proof)
try {
  const certInfo = await getTlsCertificateFromIp(ip_address);
  let extracted = null;

  if (certInfo && (certInfo.commonName || certInfo.subjectAltName)) {
    // 1) Probeer CN
    if (certInfo.commonName?.includes('.')) {
      extracted = cleanAndValidateDomain(
        certInfo.commonName,
        ENRICHMENT_SOURCES.TLS,
        asname, org_id, page_url, ip_address,
        confidence, confidence_reason
      );
    }

    // 2) Anders: pak kortste SAN
    if (!extracted && certInfo.subjectAltName) {
      const matches = certInfo.subjectAltName.match(/DNS:([A-Za-z0-9.-]+\.[A-Za-z0-9-]{2,})/g);
      if (matches && matches.length > 0) {
        const cleaned = matches
          .map(m => stripSubdomain(m.replace('DNS:', '').trim()))
          .filter(Boolean);
        const uniqueDomains = [...new Set(cleaned)];
        const chosen = uniqueDomains.sort((a, b) => a.length - b.length)[0];

        extracted = cleanAndValidateDomain(
          chosen,
          ENRICHMENT_SOURCES.TLS,
          asname, org_id, page_url, ip_address,
          confidence, confidence_reason
        );
      }
    }

    if (extracted) {
      // ✅ Succes: signal + log used=true
      const signal = await logDomainSignal({
        ip_address,
        domain: extracted,
        source: ENRICHMENT_SOURCES.TLS,
        confidence: 0.75,
        confidence_reason: CONFIDENCE_REASONS.TLS
      });
      if (signal) domainSignals.push(signal);

      await supabaseAdmin.from('tls_log').insert({
        ip_address,
        common_name: certInfo.commonName || null,
        subject_alt_name: certInfo.subjectAltName || null,
        extracted_domain: extracted,
        used: true,
        confidence: 0.75,
        confidence_reason: CONFIDENCE_REASONS.TLS,
        enrichment_source: ENRICHMENT_SOURCES.TLS
      });
    } else {
      // ❌ Geen domein uit TLS te halen
      await supabaseAdmin.from('tls_log').insert({
        ip_address,
        common_name: certInfo?.commonName || null,
        subject_alt_name: certInfo?.subjectAltName || null,
        extracted_domain: null,
        used: false,
        confidence: null,
        confidence_reason: 'no domain extracted from TLS',
        enrichment_source: ENRICHMENT_SOURCES.TLS
      });
    }
  } else {
    // ❌ Geen certificate info beschikbaar
    await supabaseAdmin.from('tls_log').insert({
      ip_address,
      common_name: null,
      subject_alt_name: null,
      extracted_domain: null,
      used: false,
      confidence: null,
      confidence_reason: 'no TLS certificate info',
      enrichment_source: ENRICHMENT_SOURCES.TLS
    });
  }
} catch (e) {
  console.warn('⚠️ TLS-certificaat ophalen mislukt:', e.message);
  // ❌ Exception: log altijd een rij met used=false
  await supabaseAdmin.from('tls_log').insert({
    ip_address,
    common_name: null,
    subject_alt_name: null,
    extracted_domain: null,
    used: false,
    confidence: null,
    confidence_reason: 'tls fetch error',
    enrichment_source: ENRICHMENT_SOURCES.TLS
  });
}


    // 🌐 Stap 6 – HTTP fetch naar IP → SIGNAL
// ⬇️ VERVANG je hele try/catch-blok door dit:
try {
  const result = await getDomainFromHttpIp(ip_address);

  const extractedDomain = cleanAndValidateDomain(
    result.extracted_domain,
    ENRICHMENT_SOURCES.HTTP_FETCH,
    asname,
    org_id,
    page_url,
    ip_address,
    confidence,
    confidence_reason
  );

  // 1) Insert + id terughalen
  const { data: httpInserted } = await supabaseAdmin
    .from('http_fetch_log')
    .insert({
      ip_address,
      fetched_at: new Date().toISOString(),
      success: result.success || false,
      extracted_domain: extractedDomain || null,
      enrichment_source: ENRICHMENT_SOURCES.HTTP_FETCH,
      confidence: result.confidence || null,
      confidence_reason: result.confidence_reason || CONFIDENCE_REASONS.HTTP_FETCH,
      redirect_location: result.redirect_location || null,
      og_url: result.og_url || null,
      html_snippet: result.html_snippet || null,
      error_message: result.error_message || null
    })
    .select('id')
    .single();

  const httpFetchInsertId = httpInserted?.id || null;

  // 2) Hints uit headers/HTML/robots halen en in dezelfde rij updaten
  try {
    const hdrs = result.headers || {};         // { 'set-cookie': [..], 'access-control-allow-origin': [...] }
    const html = result.raw_html || '';
    const robots = result.robots_txt || '';

    // Set-Cookie: Domain=...
    const setCookieArr = Array.isArray(hdrs['set-cookie']) ? hdrs['set-cookie'] : [];
    const setCookieDomains = [];
    for (const c of setCookieArr) {
      const m = /domain=([^;]+)/i.exec(String(c));
      if (m?.[1]) setCookieDomains.push(m[1].trim().toLowerCase());
    }

    // CORS: Access-Control-Allow-Origin
    const aco = hdrs['access-control-allow-origin'];
    const allowOrigins = Array.isArray(aco)
      ? aco
      : (aco ? String(aco).split(',').map(s => s.trim()) : []);

    // HTML: canonical/og/manifest
    let canonicalHost = null, ogHost = null, manifestUrl = null, sitemapUrls = [];

    const canon = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i.exec(html);
    if (canon?.[1]) { try { canonicalHost = new URL(canon[1], 'http://dummy').hostname; } catch {} }

    const og = /<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)/i.exec(html);
    if (og?.[1])    { try { ogHost = new URL(og[1], 'http://dummy').hostname; } catch {} }

    const manifest = /<link[^>]+rel=["']manifest["'][^>]*href=["']([^"']+)/i.exec(html);
    if (manifest?.[1]) manifestUrl = manifest[1];

    // robots.txt → sitemap(s)
    if (robots) {
      const ms = [...robots.matchAll(/sitemap:\s*([^\s]+)/ig)].map(m => m[1]);
      sitemapUrls = ms.length ? ms : [];
    }

    // Update dezelfde rij met headers/robots/hints
    if (httpFetchInsertId) {
      await supabaseAdmin.from('http_fetch_log')
        .update({
          headers: hdrs,
          robots_txt: robots || null,
          hints: {
            set_cookie_domains: setCookieDomains.length ? setCookieDomains : null,
            allow_origins: allowOrigins.length ? allowOrigins : null,
            canonical_host: canonicalHost || null,
            og_url_host: ogHost || null,
            manifest_url: manifestUrl || null,
            sitemap_urls: sitemapUrls.length ? sitemapUrls : null
          }
        })
        .eq('id', httpFetchInsertId);
    }

    // 3) Signalen bijschrijven op basis van hints

    // 3a) Cookie-domeinen
    for (const raw of setCookieDomains) {
      const cand = cleanAndValidateDomain(
        raw,
        ENRICHMENT_SOURCES.HTTP_FETCH,
        asname, org_id, page_url, ip_address,
        confidence, confidence_reason
      );
      if (!cand) continue;
      const sig = await logDomainSignal({
        ip_address,
        domain: cand,
        source: ENRICHMENT_SOURCES.HTTP_FETCH,
        confidence: 0.58,
        confidence_reason: 'Set-Cookie Domain'
      });
      if (sig) domainSignals.push(sig);
    }

    // 3b) CORS allow-origin
    // 3b) CORS allow-origin (robuuster: skip "*" / "null" / localhost / IPs; fallback zonder schema; dedupe)
{
  const seen = new Set(); // dedupe
  for (const raw of allowOrigins) {
    const val = String(raw || '').trim().toLowerCase();
    if (!val) continue;

    // Sla wildcards/onbruikbaar over
    if (val === '*' || val === 'null') continue;

    // Skip localhost en bekende dev-origins
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(val)) continue;

    // Skip IP-origins (IPv4/IPv6)
    if (/^https?:\/\/\d{1,3}(\.\d{1,3}){3}(?::\d+)?\/?$/.test(val)) continue; // IPv4
    if (/^https?:\/\/\[[0-9a-f:]+\](?::\d+)?\/?$/i.test(val)) continue;        // IPv6

    // Hostname extraheren – met schema via URL, anders bare-host fallback
    let host = null;
    try {
      const norm = val.includes('://') ? val : `https://${val.replace(/^\/\//, '')}`;
      host = new URL(norm).hostname;
    } catch {
      const m = val.match(/^([a-z0-9.-]+)$/i);
      host = m ? m[1] : null;
    }
    if (!host) continue;

    // Skip interne suffixen (voorkomt ruis)
    if (/\.(local|lan|internal|intra|corp)$/i.test(host)) continue;

    // Dedupe exact dezelfde host
    if (seen.has(host)) continue;
    seen.add(host);

    const cand = cleanAndValidateDomain(
      host,
      ENRICHMENT_SOURCES.HTTP_FETCH,
      asname, org_id, page_url, ip_address,
      confidence, confidence_reason
    );
    if (!cand) continue;

    const sig = await logDomainSignal({
      ip_address,
      domain: cand,
      source: ENRICHMENT_SOURCES.HTTP_FETCH,
      confidence: 0.55,
      confidence_reason: 'CORS allow-origin'
    });
    if (sig) domainSignals.push(sig);
  }
}


    // 3c) canonical/og hosts
    for (const rawHost of [canonicalHost, ogHost].filter(Boolean)) {
      const cand = cleanAndValidateDomain(
        rawHost,
        ENRICHMENT_SOURCES.HTTP_FETCH,
        asname, org_id, page_url, ip_address,
        confidence, confidence_reason
      );
      if (!cand) continue;
      const sig = await logDomainSignal({
        ip_address,
        domain: cand,
        source: ENRICHMENT_SOURCES.HTTP_FETCH,
        confidence: 0.6,
        confidence_reason: 'HTML canonical/og'
      });
      if (sig) domainSignals.push(sig);
    }
  } catch (hintErr) {
    console.warn('⚠️ header/html hints parsing faalde:', hintErr.message);
  }

  // bestaand gedrag: direct signaal als extractedDomain er al is
  if (result.success && extractedDomain) {
    const signal = await logDomainSignal({
      ip_address,
      domain: extractedDomain,
      source: ENRICHMENT_SOURCES.HTTP_FETCH,
      confidence: result.confidence || 0.6,
      confidence_reason: result.confidence_reason || CONFIDENCE_REASONS.HTTP_FETCH
    });
    if (signal) domainSignals.push(signal);
  }
} catch (e) {
  console.warn('⚠️ HTTP fetch naar IP mislukte:', e.message);

  await supabaseAdmin.from('http_fetch_log').insert({
    ip_address,
    fetched_at: new Date().toISOString(),
    success: false,
    error_message: e.message || 'onbekende fout'
  });
}



   // 🖼️ Stap 7 – favicon hash matching → SIGNAL
// 🖼️ Stap 7 – favicon hash matching → SIGNAL
try {
  const hash = await getFaviconHash(ip_address);
  if (hash) {
    const { data: match } = await supabaseAdmin
      .from('favicon_hash_map')
      .select('*')
      .eq('hash', hash)
      .single();

    const logInserts = [];

    const matchedDomain = match?.domain
      ? cleanAndValidateDomain(
          match.domain,
          ENRICHMENT_SOURCES.FAVICON,
          asname,
          org_id,
          page_url,
          ip_address,
          confidence,
          confidence_reason
        )
      : null;

    if (matchedDomain) {
      // -------- 3A: last_seen bij match updaten in map --------
      {
        const upsertRes = await supabaseAdmin
          .from('favicon_hash_map')
          .upsert(
            {
              hash,
              domain: matchedDomain,
              confidence: match?.confidence ?? 0.8,
              source: 'favicon_hash',
              last_seen: new Date().toISOString()
            },
            { onConflict: 'hash' }
          );
        if (upsertRes.error) {
          console.warn('⚠️ favicon_hash_map upsert (match) error:', upsertRes.error.message, upsertRes.error.details || '');
        }
      }
      // --------------------------------------------------------

      const signal = await logDomainSignal({
        ip_address,
        domain: matchedDomain,
        source: ENRICHMENT_SOURCES.FAVICON,
        confidence: match?.confidence || 0.8,
        confidence_reason: CONFIDENCE_REASONS.FAVICON
      });
      if (signal) domainSignals.push(signal);

      logInserts.push(
        supabaseAdmin.from('favicon_hash_log').insert({
          ip_address,
          favicon_hash: hash,
          matched_domain: matchedDomain,
          used: true,
          confidence: match?.confidence || 0.8,
          confidence_reason: CONFIDENCE_REASONS.FAVICON
        })
      );
    } else {
      // -------- 3B (optioneel): onbekende hash als 'observed' registreren --------
      {
        const upsertRes = await supabaseAdmin
          .from('favicon_hash_map')
          .upsert(
            {
              hash,
              domain: null,
              confidence: 0.5,                 // neutrale default
              source: 'observed',              // aangeeft dat er nog geen mapping is
              last_seen: new Date().toISOString()
            },
            { onConflict: 'hash' }
          );
        if (upsertRes.error) {
          console.warn('⚠️ favicon_hash_map upsert (observed) error:', upsertRes.error.message, upsertRes.error.details || '');
        }
      }
      // ---------------------------------------------------------------------------

      logInserts.push(
        supabaseAdmin.from('favicon_hash_log').insert({
          ip_address,
          favicon_hash: hash,
          matched_domain: null,
          used: false,
          confidence: null,
          confidence_reason: 'Geen match in favicon_hash_map'
        })
      );
    }

    // Logging inserts uitvoeren + errors tonen
    const results = await Promise.all(logInserts);
    for (const r of results) {
      if (r?.error) {
        console.warn('⚠️ favicon_hash_log insert error:', r.error.message, r.error.details || '');
      }
    }
  }
} catch (err) {
  console.warn('⚠️ Favicon match faalde:', err.message);
}

// BEGIN PATCH: Favicon pHash (naast bestaande hash)
async function getFaviconPHash(ip) {
  // 3a) imghash lazy inladen (werkt in Next/Vercel bundling)
  let imghashMod;
  try {
    // ESM dynamic import -> bundlers zien 'imghash' en nemen 'm mee
    imghashMod = await import('imghash');
  } catch (e) {
    console.warn('imghash niet aanwezig — pHash stap wordt overgeslagen:', e.message);
    return null; // netjes overslaan i.p.v. crashen
  }
  const imghash = imghashMod.default || imghashMod;

  // 3b) favicon ophalen (gebruik http/https modules)
  function fetchBuffer(url, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const proto = url.startsWith('https') ? require('node:https') : require('node:http');
      const req = proto.get(url, { timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch {} resolve(null); });
    });
  }

  for (const scheme of ['https', 'http']) {
    const buf = await fetchBuffer(`${scheme}://${ip}/favicon.ico`);
    if (!buf || buf.length < 64) continue;
    try {
      const phash = await imghash.hash(buf, 16, 'hex'); // 64-bit hex
      return String(phash);
    } catch {}
  }
  return null;
}


try {
  const phash = await getFaviconPHash(ip_address);
  if (phash) {
    const { data: match } = await supabaseAdmin
      .from('favicon_hash_map')
      .select('*')
      .eq('phash', phash)
      .maybeSingle();

    if (match?.domain) {
      const cand = cleanAndValidateDomain(
        match.domain, ENRICHMENT_SOURCES.FAVICON, asname, org_id, page_url, ip_address, confidence, confidence_reason
      );
      if (cand) {
        const sig = await logDomainSignal({
          ip_address, domain: cand, source: ENRICHMENT_SOURCES.FAVICON,
          confidence: match.confidence ?? 0.75, confidence_reason: 'favicon pHash match'
        });
        if (sig) domainSignals.push(sig);

        await supabaseAdmin.from('favicon_hash_log').insert({
          ip_address, favicon_phash: phash, matched_domain: cand,
          used: true, confidence: match.confidence ?? 0.75, confidence_reason: 'favicon pHash match'
        });

        await supabaseAdmin
  .from('favicon_hash_map')
  .upsert(
    {
      // gebruik echte hash als die bestaat, anders stabiele synthetische PK
      hash: match?.hash ?? `ph_${phash}`,
      phash,
      domain: cand,
      confidence: match?.confidence ?? 0.75,
      source: 'phash',
      last_seen: new Date().toISOString()
    },
    { onConflict: 'hash' }
  );
      }
    } else {
      await supabaseAdmin.from('favicon_hash_log').insert({
        ip_address, favicon_phash: phash, matched_domain: null, used: false
      });
      await supabaseAdmin
  .from('favicon_hash_map')
  .upsert(
    {
      hash: match?.hash ?? `ph_${phash}`, // synthetische PK voor pHash-only
      phash,
      domain: null,
      confidence: 0.5,
      source: 'observed-phash',
      last_seen: new Date().toISOString()
    },
    { onConflict: 'hash' }
  );
    }
  }
} catch (e) {
  console.warn('⚠️ favicon pHash faalde:', e.message);
}
// END PATCH



    // 🧪 Stap 8 – Host header probing → SIGNAL
try {
  const { data: fdnsResults } = await supabaseAdmin
    .from('fdns_lookup')
    .select('domain')
    .eq('ip', ip_address);

  const domainsToTry = fdnsResults?.map(r => r.domain).filter(Boolean).slice(0, 5);

  if (domainsToTry?.length > 0) {
    const result = await probeHostHeader(ip_address, domainsToTry);

    if (result?.domain) {
  const cleanedDomain = cleanAndValidateDomain(
    result.domain,
    ENRICHMENT_SOURCES.HOST_HEADER,
    asname,
    org_id,
    page_url,
    ip_address,
    confidence,
    confidence_reason
  );

  if (cleanedDomain) {
    const signal = await logDomainSignal({
      ip_address,
      domain: cleanedDomain,
      source: ENRICHMENT_SOURCES.HOST_HEADER,
      confidence: result.confidence || 0.6,
      confidence_reason: result.reason || CONFIDENCE_REASONS.HOST_HEADER
    });
    if (signal) domainSignals.push(signal);
  }

  // ✨ Log naar host_probe_log i.p.v. host_header_log
if (Array.isArray(result?.trials) && result.trials.length > 0) {
  // Als probeHostHeader per domein trials teruggeeft, log elke poging apart
  const rows = result.trials.map(t => ({
    ip_address,
    tested_domain: t.domain || null,
    status_code: (typeof t.status === 'number') ? t.status : null,
    content_snippet: (t.snippet || t.reason || null)?.slice(0, 500) || null,
    success: !!t.ok
  }));
  await supabaseAdmin.from('host_probe_log').insert(rows);
} else {
  // Fallback: 1 samenvattende rij
  await supabaseAdmin.from('host_probe_log').insert({
    ip_address,
    tested_domain: cleanedDomain || (Array.isArray(domainsToTry) ? domainsToTry[0] : null),
    status_code: (typeof result?.status_code === 'number') ? result.status_code : null,
    content_snippet: (result?.html_snippet || result?.snippet || result?.reason || null)?.slice(0, 500) || null,
    success: !!cleanedDomain
  });
}
}

  }
} catch (e) {
  console.warn('⚠️ Host header probing faalde:', e.message);
}

// 🔐 EXTRA stap — TLS SNI probe (shared IP bevestigen)
// Plakken: ná host header probing, vóór "✅ Stap 9 – Combineer signalen"
try {
  // 1) Kandidaten verzamelen: fdns_lookup + alles wat we al als signalen zagen
  const { data: fdnsResults } = await supabaseAdmin
    .from('fdns_lookup')
    .select('domain')
    .eq('ip', ip_address);

  const seed = (fdnsResults || []).map(r => r.domain).filter(Boolean);
  const fromSignals = domainSignals.map(s => s.domain).filter(Boolean);
  const sniCandidates = [...new Set([...seed, ...fromSignals])].slice(0, 10); // max 10, hou 'm snel

  // 2) Per kandidaat SNI-handshake doen naar dit IP
  for (const cand of sniCandidates) {
    const tested = cleanAndValidateDomain(
      cand,
      ENRICHMENT_SOURCES.TLS,
      asname, org_id, page_url, ip_address,
      confidence, confidence_reason
    );
    if (!tested) continue;

    const cert = await new Promise((resolve) => {
      const socket = tls.connect({
        host: ip_address,
        port: 443,
        servername: tested,          // ← SNI = kandidaat domein
        rejectUnauthorized: false,   // we willen alleen het cert lezen
        ALPNProtocols: []            // geen ALPN nodig
      }, () => {
        const c = socket.getPeerCertificate(true);
        const info = {
          commonName: c?.subject?.CN || null,
          subjectAltName: c?.subjectaltname || null
        };
        socket.end();
        resolve(info);
      });
      socket.setTimeout(3000, () => { try { socket.destroy(); } catch {} resolve(null); });
      socket.on('error', () => resolve(null));
    });

    // 3) Checkt of het cert dit domein dekt (CN of SAN)
    let covers = false;
    if (cert) {
      const cn = cert.commonName?.toLowerCase();
      const san = cert.subjectAltName?.toLowerCase() || '';
      const sanList = san.split(/,\s*/).map(x => x.replace(/^dns:/, ''));

      if (cn && (cn === tested || cn.endsWith(`.${tested}`) || tested.endsWith(`.${cn}`))) covers = true;
      if (!covers && sanList.length) {
        covers = sanList.some(d => d === tested || d.endsWith(`.${tested}`) || tested.endsWith(`.${d}`));
      }
    }

    // 4) Log altijd in tls_log; als het dekt, markeer used + confidence
    await supabaseAdmin.from('tls_log').insert({
      ip_address,
      tested_domain: tested,
      sni: true,
      common_name: cert?.commonName || null,
      subject_alt_name: cert?.subjectAltName || null,
      extracted_domain: covers ? tested : null,
      used: !!covers,
      confidence: covers ? 0.75 : null,
      confidence_reason: covers ? 'TLS SNI confirm' : null,
      enrichment_source: ENRICHMENT_SOURCES.TLS
    });

    // 5) Bij een hit: extra signaal toevoegen
    if (covers) {
      const sig = await logDomainSignal({
        ip_address,
        domain: tested,
        source: ENRICHMENT_SOURCES.TLS,
        confidence: 0.75,
        confidence_reason: 'TLS SNI confirm'
      });
      if (sig) domainSignals.push(sig);
    }
  }
} catch (e) {
  console.warn('⚠️ TLS SNI probing faalde:', e.message);
}

// BEGIN PATCH: helper voor email-DNS hints
async function emailDnsHints(domain, ip) {
  let spf = null, dmarc = null, mxHosts = [], mxPointsToIp = false;
  try {
    const txt = await dns.resolveTxt(domain);
    const spfRec = (txt.find(arr => arr.join('').toLowerCase().startsWith('v=spf1')) || null);
    spf = spfRec ? spfRec.join('') : null;
  } catch {}
  try {
    const dmarcRec = await dns.resolveTxt(`_dmarc.${domain}`);
    if (dmarcRec?.length) dmarc = dmarcRec.map(a => a.join('')).join(' ');
  } catch {}
  try {
    const mx = await dns.resolveMx(domain);
    mxHosts = mx.map(m => m.exchange);
    for (const h of mxHosts) {
      try {
        const a = await dns.resolve(h);
        if (a?.map(String).includes(ip)) { mxPointsToIp = true; break; }
      } catch {}
    }
  } catch {}
  let scoreBoost = 0;
  if (spf) scoreBoost += 0.05;
  if (dmarc) scoreBoost += 0.05;
  if (mxHosts.length) scoreBoost += 0.05;
  if (mxPointsToIp) scoreBoost += 0.05;
  return { spf, dmarc, mxHosts, mxPointsToIp, scoreBoost };
}
// END PATCH


// BEGIN PATCH: email-DNS correlatie + cache + signalen
try {
  const candidateDomains = [...new Set(domainSignals.map(s => s.domain))].slice(0, 10);
  for (const cand of candidateDomains) {
    const hints = await emailDnsHints(cand, ip_address);

    if (hints.spf || hints.dmarc || hints.mxHosts?.length) {
      const { data: existing } = await supabaseAdmin
        .from('domain_enrichment_cache')
        .select('email_dns')
        .eq('company_domain', cand)
        .maybeSingle();

      if (!existing?.email_dns) {
        await supabaseAdmin.from('domain_enrichment_cache').upsert({
          company_domain: cand,
          email_dns: {
            spf: hints.spf || null,
            dmarc: hints.dmarc || null,
            mx_hosts: hints.mxHosts?.length ? hints.mxHosts : null,
            mx_points_to_ip: hints.mxPointsToIp || false
          },
          email_dns_checked_at: new Date().toISOString()
        });
      }
    }

    if (hints.scoreBoost > 0) {
      const sig = await logDomainSignal({
        ip_address, domain: cand,
        source: ENRICHMENT_SOURCES.HTTP_FETCH, // infra-hints → lage/medium bron
        confidence: 0.05 + Math.min(hints.scoreBoost, 0.2),
        confidence_reason: 'Email DNS correlation'
      });
      if (sig) domainSignals.push(sig);
    }
  }
} catch (e) {
  console.warn('⚠️ email DNS hints faalde:', e.message);
}
// END PATCH


   // ✅ Stap 9 – Combineer signalen
// Kleine dedupe: dezelfde bron + hetzelfde domein telt maar één keer
if (domainSignals.length) {
  const seen = new Set();
  domainSignals = domainSignals.filter(s => {
    const key = `${s.source}:${s.domain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

if (!company_domain && domainSignals.length > 0) {
  const likely = getLikelyDomainFromSignals(domainSignals);

  if (likely?.domain) {
    const freqBoost = await calculateConfidenceByFrequency(ip_address, likely.domain);
    if (freqBoost && freqBoost.confidence > likely.confidence) {
      likely.confidence = freqBoost.confidence;
      likely.confidence_reason = freqBoost.reason;
      console.log('🔁 Confidence aangepast op basis van frequentieboost:', freqBoost);
    }
  }

// BEGIN PATCH: confirmed by form (directe query, snel dankzij indexen)
try {
  if (likely?.domain) {
    // 1) Exacte match: (ip, domain)
    const q1 = await supabaseAdmin
      .from('form_submission_log')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip_address)
      .eq('domain', likely.domain);
    const count1 = (q1 && typeof q1.count === 'number') ? q1.count : 0;

    // 2) Fallback: (ip, email eindigt op @domain) — trigram index helpt
    const q2 = await supabaseAdmin
      .from('form_submission_log')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip_address)
      .ilike('email', `%@${likely.domain}`);
    const count2 = (q2 && typeof q2.count === 'number') ? q2.count : 0;

    if ((count1 + count2) > 0) {
      likely.confidence = Math.max(likely.confidence ?? 0, 0.8);
      likely.confidence_reason = (likely.confidence_reason ? likely.confidence_reason + ' + ' : '') + 'confirmed by form';
    }
  }
} catch (e) {
  console.warn('⚠️ confirmed-by-form live check faalde:', e.message);
}
// END PATCH


  if (likely) {
    // Laat ook het 'likely domain' via onze centrale validatie gaan
    const validatedLikely = cleanAndValidateDomain(
      likely.domain,
      ENRICHMENT_SOURCES.FINAL_LIKELY,
      asname,
      org_id,
      page_url,
      ip_address,
      likely.confidence,
      likely.confidence_reason
    );

    if (!validatedLikely) {
  console.log(`⛔ Domein uit signals geblokkeerd door cleanAndValidateDomain: ${likely.domain}`);
  await markQueue('skipped', 'skipped: blocked by cleanAndValidateDomain');
  return res.status(200).json({ ignored: true, reason: 'blocked by cleanAndValidateDomain' });
}


    company_domain = validatedLikely;
    enrichment_source = likely.enrichment_source || ENRICHMENT_SOURCES.FINAL_LIKELY;
    confidence = likely.confidence;
    confidence_reason = likely.confidence_reason;

    console.log('🧠 Gekozen domein op basis van signalen:', company_domain);

    await supabaseAdmin.from('domain_signal_log').insert({
      ip_address,
      signals: domainSignals,
      chosen_domain: company_domain,
      enrichment_source,
      confidence,
      confidence_reason,
      site_id: site_id || null,
page_url: page_url || null,
    });
  } else {
    console.log('❌ Geen domein gekozen op basis van gecombineerde signalen');

    await supabaseAdmin.from('domain_signal_log').insert({
      ip_address,
      signals: domainSignals,
      chosen_domain: null,
      enrichment_source: ENRICHMENT_SOURCES.FINAL_LIKELY,
      confidence: null,
confidence_reason: CONFIDENCE_REASONS.FINAL_LIKELY,
site_id: site_id || null,
page_url: page_url || null,
    });
  }
}


    // ---- BASELINE PATHS -----------------------------------------------------

    if (isISP && !company_domain) {
      await supabaseAdmin.from('ignored_ip_log').insert({
  ip_address,
  as_name: asname,
  reason: 'known ISP (no valid domain)',
  confidence: (typeof confidence === 'number' && !Number.isNaN(confidence)) ? confidence : 0.3,
  confidence_reason: (confidence_reason && confidence_reason.trim()) ? confidence_reason: CONFIDENCE_REASONS.ISP_BASELINE,
  ignored_at: new Date().toISOString(),
  page_url: page_url || null,
  signals: domainSignals.length > 0 ? domainSignals : null,
  ignore_type: 'isp' // ✅ nieuw
});

await markQueue('skipped', 'skipped: known ISP (no valid domain)');
return res.status(200).json({ ignored: true, reason: 'known ISP (no valid domain)' });
    }

    if (!isISP && !company_domain) {
      await supabaseAdmin.from('ignored_ip_log').insert({
  ip_address,
  as_name: asname || null,
  reason: 'no domain found after full enrichment',
  confidence: (typeof confidence === 'number' && !Number.isNaN(confidence)) ? confidence : 0.3,
  confidence_reason: (confidence_reason && confidence_reason.trim()) ? confidence_reason : CONFIDENCE_REASONS.IPAPI_BASELINE,
  ignored_at: new Date().toISOString(),
  page_url: page_url || null,
  signals: domainSignals.length > 0 ? domainSignals : null,
  ignore_type: 'no-domain' // ✅ nieuw
});

await markQueue('skipped', 'skipped: no domain found');
return res.status(200).json({ ignored: true, reason: 'no domain found' });
    }

    // 🧠 Check op bestaande enrichment in ip_enrichment_cache
    let cachedDomainEnrichment = null;

    try {
      const { data: domainCache, error: domainCacheError } = await supabaseAdmin
        .from('ip_enrichment_cache')
        .select('*')
        .eq('ip', ip_address)
        .single();

      if (domainCache && !domainCacheError) {
        console.log('🧠 Hergebruik enrichment uit ip_enrichment_cache:', domainCache);

        domain_lat = domainCache.lat || null;
        domain_lon = domainCache.lon || null;
        phone = domainCache.phone || null;
        email = domainCache.email || null;
        linkedin_url = domainCache.linkedin_url || null;
        facebook_url = domainCache.facebook_url || null;
        instagram_url = domainCache.instagram_url || null;
        twitter_url = domainCache.twitter_url || null;
        meta_description = domainCache.meta_description || null;
        confidence = domainCache.auto_confidence || domainCache.confidence || null;
        confidence_reason = domainCache.auto_confidence_reason || domainCache.confidence_reason || null;

        // 🧠 Niet opnieuw enrichen
        cachedDomainEnrichment = {
          reused: true,
          category: null,
          name: company_name,
          domain_address: null,
          domain_postal_code: null,
          domain_city: null,
          domain_country: null
        };
        if (company_domain) {
  company_domain = cleanAndValidateDomain(
    company_domain,
   ENRICHMENT_SOURCES.CACHE_REUSE,
    asname,
    org_id,
    page_url,
    ip_address,
    confidence,
    confidence_reason
  );
}

      }
    } catch (e) {
      console.warn('⚠️ ip_enrichment_cache fetch faalde:', e.message);
    }

    // 🗺️ Verrijken vanaf company_domain (indien aanwezig)
    if (company_domain) {
      let domainEnrichment = cachedDomainEnrichment || null;

      try {
        domainEnrichment = await enrichFromDomain(company_domain);
        if (domainEnrichment?.domain) {
  const cleaned = cleanAndValidateDomain(
    domainEnrichment.domain,
    ENRICHMENT_SOURCES.GMAPS,
    asname,
    org_id,
    page_url,
    ip_address,
    confidence,
    confidence_reason
  );
  if (cleaned) {
    company_domain = cleaned;
  }
}

      } catch (e) {
        console.error("❌ enrichFromDomain() crashte:", e.message);
      }

      let scraped = null;
      try {
        scraped = await scrapeWebsiteData(company_domain);

        if (!scraped || Object.values(scraped).every(v => !v)) {
          await supabaseAdmin.from('scrape_log').insert({
            domain: company_domain,
            success: false,
            error_message: 'Scraping leverde geen bruikbare data op',
            result: scraped || null
          });
        } else {
          await supabaseAdmin.from('scrape_log').insert({
            domain: company_domain,
            success: true,
            result: scraped
          });
        }
      } catch (e) {
        console.warn("⚠️ scrapeWebsiteData() error:", e.message);
        await supabaseAdmin.from('scrape_log').insert({
          domain: company_domain,
          success: false,
          error_message: e.message || 'Onbekende scrapingfout'
        });
      }

      if (scraped) {
  phone = scraped.phone || null;
  email = scraped.email || null;
  linkedin_url = scraped.linkedin_url || null;
  facebook_url = scraped.facebook_url || null;
  instagram_url = scraped.instagram_url || null;
  twitter_url = scraped.twitter_url || null;
  meta_description = scraped.meta_description || null;

  // Scrape mag nooit de primaire bron overschrijven:
  if (!enrichment_source) {
    enrichment_source = ENRICHMENT_SOURCES.SCRAPE;
  }
}


      if (domainEnrichment) {
        domain_lat = domainEnrichment.lat || null;
        domain_lon = domainEnrichment.lon || null;
        company_name = domainEnrichment.name || null;
        domain_address = domainEnrichment.domain_address || null;
        domain_postal_code = domainEnrichment.domain_postal_code || null;
        domain_city = domainEnrichment.domain_city || null;
        domain_country = domainEnrichment.domain_country || null;
        category = domainEnrichment.category || null;
        enrichment_source = ENRICHMENT_SOURCES.GMAPS;

        // 👇 Override confidence op basis van frequentie (indien aanwezig)
        const freqBoost = await calculateConfidenceByFrequency(ip_address, company_domain);
        if (freqBoost) {
          confidence = freqBoost.confidence;
          confidence_reason = freqBoost.reason;
        } else {
          confidence = domainEnrichment.confidence || 0.65;
          confidence_reason = domainEnrichment.confidence_reason || CONFIDENCE_REASONS.GMAPS;
        }

        // Eén duidelijke call, geen dubbeling
        await upsertDomainEnrichmentCache(company_domain, {
          domain_lat,
          domain_lon,
          radius: null,
          maps_result: domainEnrichment.raw || null,
          confidence,
          confidence_reason,
          phone,
          email,
          linkedin_url,
          facebook_url,
          instagram_url,
          twitter_url,
          meta_description
        });
      }
    }


    // Confidence nooit omlaag
const finalConfidence =
  (typeof confidence === 'number' && !Number.isNaN(confidence))
    ? (cached?.confidence != null ? Math.max(confidence, cached.confidence) : confidence)
    : (cached?.confidence ?? null);

// ⛔️ Confidence-drempel check
const MIN_CONFIDENCE = 0.5;

// Alleen blokkeren als er GEEN domein is én confidence te laag is
// 👉 Als er wél een domein is, mag hij altijd door (ook bij lage confidence)
if ((!company_domain || company_domain.trim() === '') 
    && (typeof finalConfidence === 'number' && finalConfidence < MIN_CONFIDENCE)) {
  console.log(`⛔ Geen domein én confidence (${finalConfidence}) lager dan drempel (${MIN_CONFIDENCE}) → niet in cache`);
  {
  const { error } = await supabaseAdmin.from('ignored_ip_log').insert({
    ip_address,
    as_name: asname || null,
    reason: 'low confidence enrichment (no domain)',
    page_url: page_url || null,
    ignored_at: new Date().toISOString(),
    ignore_type: 'low-confidence',
    signals: {
      org_id: org_id || null,
      final_confidence: (typeof finalConfidence === 'number' && !Number.isNaN(finalConfidence)) ? finalConfidence : null,
      confidence_reason: confidence_reason || null
    }
  });
  if (error) console.error('❌ ignored_ip_log insert (low-confidence) faalde:', error.message, error.details || '');
}
  await markQueue('skipped', 'skipped: low confidence no domain');
return res.status(200).json({ ignored: true, reason: 'low confidence no domain' });
}

// Coördinaten alleen als beide bestaan (voor DOMAIN coords)
const domainLatOk = validNum(domain_lat);
const domainLonOk = validNum(domain_lon);

// Payload bouwen + lege waarden weggooien (GEEN IP lat/lon)
const cachePayload = pruneEmpty({
  ip_address,
  company_name,
  company_domain,
  location,
ip_postal_code: ip_postal_code || undefined,
ip_city: ip_city || undefined,
ip_country: ip_country || undefined,


  enriched_at: new Date().toISOString(),
  last_updated: new Date().toISOString(),
  enrichment_source,
  confidence: finalConfidence,
  confidence_reason,
  rdns_hostname: reverseDnsDomain || undefined,

  domain_address,
  domain_postal_code,
  domain_city,
  domain_country,
  domain_lat: (domainLatOk && domainLonOk) ? domain_lat : undefined,
  domain_lon: (domainLatOk && domainLonOk) ? domain_lon : undefined,

  phone,
  email,
  linkedin_url,
  facebook_url,
  instagram_url,
  twitter_url,
  meta_description,
  category
});

// 🔒 Manual lock? Sla helemaal niets op/over.
if (manualLock && cached) {
  console.log('🔒 manual_enrich=true → ipapi_cache niet overschrijven');
  ipData = cached;
} else if (!cached) {
  const { error: insertErr } = await supabaseAdmin
    .from('ipapi_cache')
    .insert(cachePayload);
  if (insertErr) {
    console.error('❌ Insert error ipapi_cache:', insertErr);
  } else {
    console.log('✅ Nieuw profiel opgeslagen in ipapi_cache');
    ipData = cachePayload;
  }
} else {
  // Alleen updaten als het aantoonbaar beter is
  const improved =
    (!cached.company_domain && cachePayload.company_domain) ||
    (!cached.company_name && cachePayload.company_name) ||
    (finalConfidence != null && (cached.confidence == null || finalConfidence > cached.confidence)) ||
    (!cached.domain_address && cachePayload.domain_address) ||
    (!cached.domain_city && cachePayload.domain_city) ||
    (!cached.domain_country && cachePayload.domain_country) ||
    (!cached.rdns_hostname && cachePayload.rdns_hostname) ||
    (!cached.phone && cachePayload.phone) ||
    (!cached.email && cachePayload.email) ||
    (!cached.linkedin_url && cachePayload.linkedin_url) ||
    (!cached.facebook_url && cachePayload.facebook_url) ||
    (!cached.instagram_url && cachePayload.instagram_url) ||
    (!cached.twitter_url && cachePayload.twitter_url) ||
    (!cached.meta_description && cachePayload.meta_description) ||
    (!cached.category && cachePayload.category) ||
    ((!validNum(cached.domain_lat) || !validNum(cached.domain_lon)) &&
      validNum(cachePayload.domain_lat) && validNum(cachePayload.domain_lon));

  if (improved) {
    const { error: updErr } = await supabaseAdmin
      .from('ipapi_cache')
      .update(cachePayload)
      .eq('ip_address', ip_address);

    if (updErr) {
      console.error('❌ Update error ipapi_cache:', updErr);
    } else {
      console.log('✅ Cache succesvol bijgewerkt');
      ipData = { ...cached, ...cachePayload };
    }
  } else {
    console.log('⚠️ Bestaand profiel is al even goed of beter → niet overschreven');
    ipData = cached;
  }
}

  }

  // ⛔️ Belangrijk: geen insert in 'leads' vanuit /api/lead!
  // Deze endpoint verzorgt alleen enrichment + cache.
  // track.js schrijft de pageview en triggert KvK.


  // Markeer alle pending jobs voor deze bezoeker als done
await markQueue('done', 'auto-done via live enrichment');
  return res.status(200).json({
    success: true,
    mode: 'enrichment_only',
    company_domain: ipData?.company_domain ?? null,
    company_name: ipData?.company_name ?? null,
    confidence: ipData?.confidence ?? null
  });

  } catch (err) {
  console.error('Server error:', err);
  // Label eventuele pending jobs als error
  await markQueue('error', `lead.js error: ${err?.message || 'unknown'}`);
  res.status(500).json({ error: 'Internal server error' });
}
}