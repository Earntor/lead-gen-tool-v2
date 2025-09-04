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
  'dynamic.upc.nl', 'vodafone.nl', 'versatel', 'msn.com', 'akamaitechnologies.com',
  'telenet.be', 'myaisfibre.com', 'filterplatform.nl', 'xs4all.nl', 'home.nl',
  'weserve.nl', 'crawl.cloudflare.com', 'kabelnoord.net', 'googlebot.com','client.t-mobilethuis.nl', 'starlinkisp.net', 'baremetal.scw.cloud','fbsv','sprious.com', 'your-server.de', 'vodafone.pt', 'ip.telfort.nl', 'amazonaws.com', 'dataproviderbot.com', 'apple.com', 'belgacom.be' 
];

async function logBlockedSignal({
  ip_address, domain, source, asname, reason, org_id, page_url, confidence, confidence_reason,
  ignore_type = 'blocked'
}) {
  await supabaseAdmin.from('ignored_ip_log').insert({
    ip_address,
    as_name: asname || null,
    blocked_domain: domain || null,
    blocked_source: source || null,
    reason: reason || 'blacklisted in step',
    confidence: (typeof confidence === 'number' && !Number.isNaN(confidence)) ? confidence : 0.3,
    confidence_reason: (confidence_reason && confidence_reason.trim()) ? confidence_reason : CONFIDENCE_REASONS.IPAPI_BASELINE,
    ignored_at: new Date().toISOString(),
    page_url: page_url || null,
    ignore_type
  });
}


// Kleine helpers
const validNum = (v) => typeof v === 'number' && !Number.isNaN(v);

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


function cleanAndValidateDomain(domain, source, asname, org_id, page_url, ip_address, confidence, confidence_reason) {
  if (!domain) return null;

  // basis normalisatie
  let cleaned = stripSubdomain(domain);
  if (!cleaned) return null;

  // alleen toegestane tekens
  cleaned = cleaned.replace(/[^a-z0-9.-]/g, '');

  // geen leading/trailing dot of hyphen
  cleaned = cleaned.replace(/^\.+/, '').replace(/\.+$/, '').replace(/^-+/, '').replace(/-+$/, '');

  // moet minstens één dot hebben
  if (!cleaned.includes('.')) return null;

  // geen IP-adressen
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned);
  const isIPv6 = /:/.test(cleaned);
  if (isIPv4 || isIPv6) return null;

  // labels valideren
  const labels = cleaned.split('.');
  if (labels.some(l => l.length === 0 || l.length > 63)) return null;
  if (labels.some(l => !/^[a-z0-9-]+$/.test(l))) return null;
  if (labels.some(l => l.startsWith('-') || l.endsWith('-'))) return null;

  // TLD: letters, 2–24
  const tld = labels[labels.length - 1];
if (!/^([a-z]{2,24}|xn--[a-z0-9-]{2,})$/.test(tld)) return null;

  // minstens één label met een letter
  if (!labels.some(l => /[a-z]/.test(l))) return null;

  // hosting/blacklist blokkeren
  const endsWithDomain = (host, tail) =>
  host === tail || host.endsWith(`.${tail}`);
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
      ip_address,
      domain: cleaned,
      source,
      asname,
      reason: 'blacklisted domain in cleanup',
      org_id,
      page_url,
      confidence: safeConfidence,
      confidence_reason: safeReason,
      ignore_type: 'blocked'
    });
    return null;
  }

  return cleaned;
}



async function calculateConfidenceByFrequency(ip, domain) {
  const { data, error } = await supabaseAdmin
    .from('rdns_log')
    .select('*')
    .eq('ip_address', ip)
    .order('created_at', { ascending: false })
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


  try {
    console.log('--- API LEAD DEBUG ---');
    console.log('Request body:', { ip_address, org_id, page_url });

    const { data: cached } = await supabaseAdmin
      .from('ipapi_cache')
      .select('*')
      .eq('ip_address', ip_address)
      .single();

    let ipData = cached;

    const needsDomainEnrichment =
      !cached ||
      cached.company_name === 'Testbedrijf' ||
      (cached.company_domain && (
        !cached.domain_address ||
        !cached.domain_city ||
        !cached.domain_country ||
        !cached.confidence ||
        !cached.confidence_reason ||
        !cached.meta_description ||
        !cached.phone ||
        !cached.email ||
        !cached.domain_lat ||
        !cached.domain_lon ||
        !cached.category ||
        !cached.rdns_hostname ||
        !cached.linkedin_url ||
        !cached.facebook_url ||
        !cached.instagram_url ||
        !cached.twitter_url
      ));

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

let ip_country = ipapi.country || null;
let ip_city = ipapi.city || null;
let ip_postal_code = ipapi.zip || null;

// Consistente location opbouw
let location = null;
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


     const asname = ipapi.asname || '';
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

        let score = scoreReverseDnsHostname(hostname, enrichmentStub);
        let reason = getConfidenceReason(score);

        if (extracted === 'moreketing.nl') {
          score = 0.95;
          reason = 'Whitelisted testdomein';
        }

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

    // 🔐 Stap 3 – TLS-certificaatinspectie → SIGNAL
try {
  const certInfo = await getTlsCertificateFromIp(ip_address);
  if (certInfo && (certInfo.commonName || certInfo.subjectAltName)) {
    let extracted = null;

    if (certInfo.commonName?.includes('.')) {
      extracted = cleanAndValidateDomain(
        certInfo.commonName,
        ENRICHMENT_SOURCES.TLS,
        asname,
        org_id,
        page_url,
        ip_address,
        confidence,
        confidence_reason
      );
    }

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
          asname,
          org_id,
          page_url,
          ip_address,
          confidence,
          confidence_reason
        );
      }
    }

    if (extracted) {
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
    }
  }
} catch (e) {
  console.warn('⚠️ TLS-certificaat ophalen mislukt:', e.message);
}

    // 🌐 Stap 6 – HTTP fetch naar IP → SIGNAL
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

  await supabaseAdmin.from('http_fetch_log').insert({
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
  });

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
      const signal = await logDomainSignal({
        ip_address,
        domain: matchedDomain,
        source: ENRICHMENT_SOURCES.FAVICON,
        confidence: match.confidence || 0.8,
confidence_reason: CONFIDENCE_REASONS.FAVICON
      });

      if (signal) domainSignals.push(signal);

      logInserts.push(
        supabaseAdmin.from('favicon_hash_log').insert({
          ip_address,
          favicon_hash: hash,
          matched_domain: matchedDomain,
          used: true,
          confidence: match.confidence || 0.8,
confidence_reason: CONFIDENCE_REASONS.FAVICON,
          enrichment_source: ENRICHMENT_SOURCES.FAVICON
        })
      );
    } else {
      logInserts.push(
        supabaseAdmin.from('favicon_hash_log').insert({
          ip_address,
          favicon_hash: hash,
          matched_domain: null,
          used: false,
          confidence: null,
          confidence_reason: 'Geen match in favicon_hash_map',
          enrichment_source: ENRICHMENT_SOURCES.FAVICON
        })
      );
    }

    await Promise.all(logInserts);
  }
} catch (err) {
  console.warn('⚠️ Favicon match faalde:', err.message);
}


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

  await supabaseAdmin.from('host_header_log').insert({
    ip_address,
    tried_domains: domainsToTry,
    matched_domain: cleanedDomain || null,
    used: !!cleanedDomain,
    confidence: result.confidence || 0.6,
    confidence_reason: result.reason || CONFIDENCE_REASONS.HOST_HEADER,
    enrichment_source: ENRICHMENT_SOURCES.HOST_HEADER
  });
}

  }
} catch (e) {
  console.warn('⚠️ Host header probing faalde:', e.message);
}


    // ✅ Stap 9 – Combineer signalen
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
      logged_at: new Date().toISOString()
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
      logged_at: new Date().toISOString()
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
        domainEnrichment = await enrichFromDomain(company_domain, ipapi.lat, ipapi.lon);
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
  await supabaseAdmin.from('ignored_ip_log').insert({
    ip_address,
as_name: asname || null,
    reason: 'low confidence enrichment (no domain)',
    confidence: finalConfidence,
    confidence_reason: confidence_reason || 'Onder minimumdrempel',
    ignored_at: new Date().toISOString(),
    page_url: page_url || null,
    ignore_type: 'low-confidence'
  });
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
  ip_postal_code: ipapi.zip || undefined,
  ip_city: ipapi.city || undefined,
  ip_country: ipapi.country || undefined,

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

if (!cached) {
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
