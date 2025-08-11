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


const stripSubdomain = (domain) => {
  if (!domain) return null;
  let clean = domain.trim().toLowerCase();

  clean = clean.replace(
    /^(mail|vpn|smtp|webmail|pop3|imap|owa|remote|ns\d*|mx\d*|cpanel|webdisk|autodiscover|server|host|exchange|secure|ssl|admin|gateway|proxy|support|login|portal)\./,
    ''
  );

  clean = clean.replace(/^www\./, '');

  return clean;
};


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
  user_id,
  page_url,
  anon_id,
  referrer,
  utm_source,
  utm_medium,
  utm_campaign,
  duration_seconds,
  site_id
} = req.body;



  try {
  const url = new URL(page_url);
  if (url.hostname.endsWith("vercel.app")) {
    console.log("⛔️ dashboard-bezoek gedetecteerd, wordt niet opgeslagen:", page_url);
    return res.status(200).json({ ignored: true, reason: "dashboard visit" });
  }
} catch (e) {
  console.warn("⚠️ Ongeldige page_url ontvangen, genegeerd:", page_url);
  return res.status(200).json({ ignored: true, reason: "invalid page_url" });
}


  try {
    console.log('--- API LEAD DEBUG ---');
    console.log('Request body:', { ip_address, user_id, page_url });

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

      const ip_country = ipapi.country || null;
      const ip_city = ipapi.city || null;
      const ip_postal_code = ipapi.zip || null;
      const location = ip_city && ipapi.regionName ? `${ip_city}, ${ipapi.regionName}` : ip_country;

      const knownISPs = ['Ziggo', 'KPN', 'T-Mobile', 'Vodafone', 'Tele2', 'Delta', 'Freedom Internet', 'Online.nl', 'Odido'];
      const asname = ipapi.asname || '';
      const isISP = knownISPs.some(isp => asname.toLowerCase().includes(isp.toLowerCase()));

      if (isISP) {
        console.log('⚠️ Bekende ISP gedetecteerd:', asname);
        await supabaseAdmin.from('ignored_ip_log').insert({
          ip_address,
          as_name: asname,
          reason: 'known ISP (not blocking)',
          ignored_at: new Date().toISOString()
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
    const blacklistedDomains = [
      'kpn.net', 'ziggo.nl', 'glasoperator.nl', 't-mobilethuis.nl', 'chello.nl',
      'dynamic.upc.nl', 'vodafone.nl', 'versatel', 'msn.com', 'akamaitechnologies.com',
      'sr-srv.net', 'telenet.be', 'myaisfibre.com', 'filterplatform.nl','xs4all.nl', 'home.nl', 'dfn.nl', 'weserve.nl', 'client.t-mobilethuis.nl', 'your-server.de', 'ip.telfort.nl'
    ];

    const hasBlacklisted = blacklistKeywords.some(k => lowerHost.includes(k));
    if (hasBlacklisted) continue;

    // 🧠 Gebruik stripSubdomain() in plaats van slice(-2)
    const extracted = stripSubdomain(hostname);
    if (!extracted || blacklistedDomains.includes(extracted)) continue;

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
      source: 'reverse_dns',
      confidence: score,
      confidence_reason: reason
    });

    if (signal) {
      domainSignals.push(signal);
      company_domain = extracted;
      enrichment_source = 'reverse_dns';
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

    // 1️⃣ Eerst kijken naar CommonName
    if (certInfo.commonName?.includes('.')) {
      extracted = stripSubdomain(certInfo.commonName);
    }

    // 2️⃣ Dan proberen alle DNS entries in subjectAltName
    if (!extracted && certInfo.subjectAltName) {
      const matches = certInfo.subjectAltName.match(/DNS:([a-zA-Z0-9.-]+\.[a-z]{2,})/g);

      if (matches && matches.length > 0) {
        const cleaned = matches
          .map(m => stripSubdomain(m.replace('DNS:', '').trim()))
          .filter(Boolean);

        const uniqueDomains = [...new Set(cleaned)];
        extracted = uniqueDomains.sort((a, b) => a.length - b.length)[0];
      }
    }

    if (extracted) {
      const signal = await logDomainSignal({
        ip_address,
        domain: extracted,
        source: 'tls_cert',
        confidence: 0.75,
        confidence_reason: 'TLS-certificaat CN/SAN domeinextractie'
      });

      if (signal) domainSignals.push(signal);

      await supabaseAdmin.from('tls_log').insert({
        ip_address,
        common_name: certInfo.commonName || null,
        subject_alt_name: certInfo.subjectAltName || null,
        extracted_domain: extracted,
        used: true,
        confidence: 0.75,
        confidence_reason: 'TLS-certificaat CN/SAN domeinextractie',
        enrichment_source: 'tls_cert'
      });
    }
  }
} catch (e) {
  console.warn('⚠️ TLS-certificaat ophalen mislukt:', e.message);
}



// 🌐 Stap 6 – HTTP fetch naar IP → SIGNAL
try {
  const result = await getDomainFromHttpIp(ip_address);

  const extractedDomain = stripSubdomain(result.extracted_domain);

  await supabaseAdmin.from('http_fetch_log').insert({
    ip_address,
    fetched_at: new Date().toISOString(),
    success: result.success || false,
    extracted_domain: extractedDomain || null,
    enrichment_source: result.enrichment_source || null,
    confidence: result.confidence || null,
    confidence_reason: result.confidence_reason || null,
    redirect_location: result.redirect_location || null,
    og_url: result.og_url || null,
    html_snippet: result.html_snippet || null,
    error_message: result.error_message || null
  });

  if (result.success && extractedDomain) {
    const signal = await logDomainSignal({
      ip_address,
      domain: extractedDomain,
      source: result.enrichment_source || 'http_fetch',
      confidence: result.confidence || 0.6,
      confidence_reason: result.confidence_reason || 'via HTTP fetch'
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

    const matchedDomain = match?.domain ? stripSubdomain(match.domain) : null;

    if (matchedDomain) {
      const signal = await logDomainSignal({
        ip_address,
        domain: matchedDomain,
        source: 'favicon_hash',
        confidence: match.confidence || 0.8,
        confidence_reason: 'Favicon hash match'
      });

      if (signal) domainSignals.push(signal);

      logInserts.push(
        supabaseAdmin.from('favicon_hash_log').insert({
          ip_address,
          favicon_hash: hash,
          matched_domain: matchedDomain,
          used: true,
          confidence: match.confidence || 0.8,
          confidence_reason: 'Favicon hash match'
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
          confidence_reason: 'Geen match in favicon_hash_map'
        })
      );
    }

    await Promise.all(logInserts);
  }
} catch (err) {
  console.warn("⚠️ Favicon match faalde:", err.message);
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
      const cleanedDomain = stripSubdomain(result.domain);

      const signal = await logDomainSignal({
        ip_address,
        domain: cleanedDomain,
        source: 'host_header',
        confidence: result.confidence || 0.6,
        confidence_reason: result.reason || 'Host header probe match'
      });

      if (signal) domainSignals.push(signal);
    }
  }
} catch (e) {
  console.warn('⚠️ Host header probing faalde:', e.message);
}



// ✅ Stap 9 – Combineer signalen
if (!company_domain && domainSignals.length > 0) {
  const likely = getLikelyDomainFromSignals(domainSignals);

  // 🧠 Frequentieboost toepassen op gekozen domein (indien beschikbaar)
  if (likely?.domain) {
    const freqBoost = await calculateConfidenceByFrequency(ip_address, likely.domain);
    if (freqBoost && freqBoost.confidence > likely.confidence) {
      likely.confidence = freqBoost.confidence;
      likely.confidence_reason = freqBoost.reason;
      console.log('🔁 Confidence aangepast op basis van frequentieboost:', freqBoost);
    }
  }

  if (likely) {
    // 🔐 Subdomein strippen vóór gebruik
    const cleanedDomain = stripSubdomain(likely.domain);

    company_domain = cleanedDomain;
    enrichment_source = likely.enrichment_source;
    confidence = likely.confidence;
    confidence_reason = likely.confidence_reason;

    console.log('🧠 Gekozen domein op basis van signalen:', company_domain);

    // Supabase logging
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
      enrichment_source: null,
      confidence: null,
      confidence_reason: 'Geen dominante kandidaat',
      logged_at: new Date().toISOString()
    });
  }
}



      if (isISP && !company_domain) {
  await supabaseAdmin.from('ignored_ip_log').insert({
    ip_address,
    as_name: asname,
    reason: 'known ISP (no valid domain)',
    ignored_at: new Date().toISOString(),
    user_id: user_id || null,
    page_url: page_url || null,
    signals: domainSignals.length > 0 ? domainSignals : null
  });

  // ✅ baseline cache zetten zodat track.js iets heeft
  try {
    await supabaseAdmin
      .from('ipapi_cache')
      .upsert({
        ip_address,
        company_name: null,
        company_domain: null,
        location,
        ip_street: null,
        ip_postal_code: ipapi.zip || null,
        ip_city: ipapi.city || null,
        ip_country: ipapi.country || null,
        lat: ipapi.lat || null,
        lon: ipapi.lon || null,
        enrichment_source: 'isp_baseline',
        confidence: null,
        confidence_reason: null,
        rdns_hostname: null,
        domain_address: null,
        domain_postal_code: null,
        domain_city: null,
        domain_country: null,
        domain_lat: null,
        domain_lon: null,
        phone: null,
        email: null,
        linkedin_url: null,
        facebook_url: null,
        instagram_url: null,
        twitter_url: null,
        meta_description: null,
        category: null,
        enriched_at: new Date().toISOString(),
        last_updated: new Date().toISOString()
      }, { onConflict: 'ip_address' });
  } catch (e) {
    console.warn('⚠️ baseline cache upsert (ISP) faalde:', e.message);
  }

  return res.status(200).json({ ignored: true, reason: 'known ISP (no valid domain)' });
}


if (!isISP && !company_domain) {
  await supabaseAdmin.from('ignored_ip_log').insert({
    ip_address,
    as_name: asname || null,
    reason: 'no domain found after full enrichment',
    ignored_at: new Date().toISOString(),
    user_id: user_id || null,
    page_url: page_url || null,
    signals: domainSignals.length > 0 ? domainSignals : null
  });

  // ✅ baseline cache zetten zodat track.js iets heeft
  try {
    await supabaseAdmin
      .from('ipapi_cache')
      .upsert({
        ip_address,
        company_name: null,
        company_domain: null,
        location,
        ip_street: null,
        ip_postal_code: ipapi.zip || null,
        ip_city: ipapi.city || null,
        ip_country: ipapi.country || null,
        lat: ipapi.lat || null,
        lon: ipapi.lon || null,
        enrichment_source: 'ipapi_baseline',
        confidence: null,
        confidence_reason: null,
        rdns_hostname: null,
        domain_address: null,
        domain_postal_code: null,
        domain_city: null,
        domain_country: null,
        domain_lat: null,
        domain_lon: null,
        phone: null,
        email: null,
        linkedin_url: null,
        facebook_url: null,
        instagram_url: null,
        twitter_url: null,
        meta_description: null,
        category: null,
        enriched_at: new Date().toISOString(),
        last_updated: new Date().toISOString()
      }, { onConflict: 'ip_address' });
  } catch (e) {
    console.warn('⚠️ baseline cache upsert (no-domain) faalde:', e.message);
  }

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
  }
} catch (e) {
  console.warn('⚠️ ip_enrichment_cache fetch faalde:', e.message);
}


      if (company_domain) {
if (!cachedDomainEnrichment) {
  console.log('🧠 Geen ip_enrichment_cache, probeer domain_enrichment_cache');

  const { data: domainCache, error: domainCacheError } = await supabaseAdmin
    .from('domain_enrichment_cache')
    .select('*')
    .eq('company_domain', company_domain)
    .single();

  if (domainCache && !domainCacheError) {
    console.log('🧠 Hergebruik enrichment uit domain_enrichment_cache:', domainCache);

    domain_lat = domainCache.domain_lat || null;
    domain_lon = domainCache.domain_lon || null;
    phone = domainCache.phone || null;
    email = domainCache.email || null;
    linkedin_url = domainCache.linkedin_url || null;
    facebook_url = domainCache.facebook_url || null;
    instagram_url = domainCache.instagram_url || null;
    twitter_url = domainCache.twitter_url || null;
    meta_description = domainCache.meta_description || null;
    confidence = domainCache.confidence || null;
    confidence_reason = domainCache.confidence_reason || null;
    category = domainCache.category || null;

    // 🎯 Markeer dat we dit hebben hergebruikt
    cachedDomainEnrichment = {
      reused: true,
      lat: domainCache.domain_lat || null,
      lon: domainCache.domain_lon || null,
      name: domainCache.company_name || null,
      domain_address: domainCache.domain_address || null,
      domain_postal_code: domainCache.domain_postal_code || null,
      domain_city: domainCache.domain_city || null,
      domain_country: domainCache.domain_country || null,
      confidence: domainCache.confidence || null,
      confidence_reason: domainCache.confidence_reason || null,
      category: domainCache.category || null,
      raw: domainCache.maps_result || null
    };
  }
}

let domainEnrichment = cachedDomainEnrichment || null;

try {
  domainEnrichment = await enrichFromDomain(company_domain, ipapi.lat, ipapi.lon);
} catch (e) {
  console.error("❌ enrichFromDomain() crashte:", e.message);
}

let scraped = null;
try {
  scraped = await scrapeWebsiteData(company_domain);

  // ⬇️ Log ook als het resultaat leeg of incompleet is
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
  enrichment_source = 'maps_domain';

  // 👇 Override confidence op basis van frequentie (indien aanwezig)
  const freqBoost = await calculateConfidenceByFrequency(ip_address, company_domain);
  if (freqBoost) {
    confidence = freqBoost.confidence;
    confidence_reason = freqBoost.reason;
  } else {
    confidence = domainEnrichment.confidence || 0.65;
    confidence_reason = domainEnrichment.confidence_reason || 'Verrijking via Google Maps (domain)';
  }

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


  // ✅ Upsert in ip_enrichment_cache op basis van domein
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


      const insertCache = {
        ip_address,
        company_name,
        company_domain,
        location,
        ip_street: null,
        ip_postal_code: ipapi.zip || null,
        ip_city: ipapi.city || null,
        ip_country: ipapi.country || null,
        lat: ipapi.lat,
        lon: ipapi.lon,
        enriched_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        enrichment_source,
        confidence,
        confidence_reason,
        rdns_hostname: reverseDnsDomain || null,
        domain_address,
        domain_postal_code,
        domain_city,
        domain_country,
        domain_lat,
        domain_lon,
        phone,
        email,
        linkedin_url,
        facebook_url,
        instagram_url,
        twitter_url,
        meta_description,
        category
      };

      if (!cached) {
        const { error: insertError } = await supabaseAdmin
          .from('ipapi_cache')
          .insert(insertCache);
        if (insertError) {
          console.error('❌ Insert error ipapi_cache:', insertError);
        } else {
          console.log('✅ Nieuw profiel opgeslagen in ipapi_cache');
          ipData = insertCache;
        }
      } else {
        const isImproved =
          (!cached.company_name && insertCache.company_name) ||
          (!cached.company_domain && insertCache.company_domain) ||
          (insertCache.confidence > (cached.confidence || 0)) ||
          (!cached.domain_address && insertCache.domain_address);

        if (isImproved) {
          console.log('🆙 Verbeterd profiel gedetecteerd → cache bijwerken');
          const { error: updateError } = await supabaseAdmin
            .from('ipapi_cache')
            .update({ ...insertCache, last_updated: new Date().toISOString() })
            .eq('ip_address', ip_address);

          if (updateError) {
            console.error('❌ Update error ipapi_cache:', updateError);
          } else {
            console.log('✅ Cache succesvol bijgewerkt');
            ipData = { ...cached, ...insertCache };
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

return res.status(200).json({
  success: true,
  mode: 'enrichment_only',
  company_domain: ipData?.company_domain ?? null,
  company_name: ipData?.company_name ?? null,
  confidence: ipData?.confidence ?? null
});

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}