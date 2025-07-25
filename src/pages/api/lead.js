import { supabaseAdmin } from '../../lib/supabaseAdminClient';
import { enrichFromDomain } from '../../lib/enrichFromDomain';
import { scrapeWebsiteData } from '../../lib/scrapeWebsite';
import { scoreReverseDnsHostname, getConfidenceReason } from '../../lib/hostnameScoring';
import dns from 'node:dns/promises';

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

  const { ip_address, user_id, page_url } = req.body;


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

    if (!cached || !cached.company_name) {
      const ipapiRes = await fetch(`http://ip-api.com/json/${ip_address}`);
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
      let enrichment_source = null;
      let confidence = null;
      let confidence_reason = null;
      let reverseDnsDomain = null;

      let domain_address = null;
      let domain_postal_code = null;
      let domain_city = null;
      let domain_country = null;

      let phone = null;
      let email = null;
      let linkedin_url = null;
      let facebook_url = null;
      let instagram_url = null;
      let twitter_url = null;
      let meta_description = null;
      let category = null;

      try {
        const hostnames = await dns.reverse(ip_address);
        console.log('🔍 Alle gevonden hostnames:', hostnames);

        let used = false;

        for (const hostname of hostnames) {
          const lowerHost = hostname.toLowerCase();
          const blacklistKeywords = ['dynamic', 'client', 'customer', 'dsl', 'broadband', 'home', 'pool', 'ip'];
          const blacklistedDomains = [
            'kpn.net', 'ziggo.nl', 'glasoperator.nl', 't-mobilethuis.nl', 'chello.nl',
            'dynamic.upc.nl', 'vodafone.nl', 'xs4all.nl', 'home.nl',
            'client.t-mobilethuis.nl', 'ip.telfort.nl'
          ];

          const hasBlacklisted = blacklistKeywords.some(k => lowerHost.includes(k));
          if (hasBlacklisted) continue;

          const parts = hostname.split('.');
          if (parts.length >= 2) {
            reverseDnsDomain = parts.slice(-2).join('.');
            company_domain = reverseDnsDomain;

            if (blacklistedDomains.includes(company_domain)) {
              company_domain = null;
              reverseDnsDomain = null;
              used = false;
              break;
            }

            const enrichmentStub = {
              domain: company_domain,
              address: domain_address,
              city: domain_city,
              postal_code: domain_postal_code,
              phone: null
            };

            confidence = scoreReverseDnsHostname(hostname, enrichmentStub);
confidence_reason = getConfidenceReason(confidence);

// Extra check: als domein vaker voorkomt met dit IP → confidence verhogen
const freqBoost = await calculateConfidenceByFrequency(ip_address, company_domain);
if (freqBoost && freqBoost.confidence > confidence) {
  confidence = freqBoost.confidence;
  confidence_reason = freqBoost.reason;
}


            const threshold = 0.6;

if (confidence < threshold) {
  console.log(`⛔ Confidence te laag (${confidence}) — wordt genegeerd`);
  company_domain = null;
  reverseDnsDomain = null;
  confidence = null;
  confidence_reason = null;
  enrichment_source = null;
  used = false;
  continue;
}


            enrichment_source = 'reverse_dns';
            used = true;
            break;
          }
        }

        await supabaseAdmin.from('rdns_log').insert({
          ip_address,
          raw_hostnames: hostnames,
          extracted_domain: used ? reverseDnsDomain : null,
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

      if (isISP && !company_domain) {
        await supabaseAdmin.from('ignored_ip_log').insert({
          ip_address,
          as_name: asname,
          reason: 'known ISP (no valid reverse DNS)',
          ignored_at: new Date().toISOString()
        });
        return res.status(200).json({ ignored: true, reason: 'known ISP (no valid reverse DNS)' });
      }

      if (company_domain && !company_name) {
  const domainEnrichment = await enrichFromDomain(company_domain, ipapi.lat, ipapi.lon);
    if (domainEnrichment && domainEnrichment.domain_address && domainEnrichment.domain_city) {
    const fullAddress = `${domainEnrichment.domain_address}, ${domainEnrichment.domain_city}`;
    const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json`);
    const geoData = await geoRes.json();

    if (geoData && geoData.length > 0) {
      const correctedLat = geoData[0].lat;
      const correctedLon = geoData[0].lon;

      await supabaseAdmin
        .from("ipapi_cache")
        .update({
          domain_lat: correctedLat,
          domain_lon: correctedLon
        })
        .eq("ip_address", ip_address);
    }
  }

  const scraped = await scrapeWebsiteData(company_domain);

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
}


      let ip_street = null;
      if (ipapi.lat && ipapi.lon) {
        const nominatimRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${ipapi.lat}&lon=${ipapi.lon}`
        );
        const nominatimData = await nominatimRes.json();
        const road = nominatimData.address?.road || '';
        const houseNumber = nominatimData.address?.house_number || '';
        ip_street = `${road} ${houseNumber}`.trim() || null;

        await supabaseAdmin
  .from("ipapi_cache")
  .update({
    domain_lat: data[0].lat,
    domain_lon: data[0].lon
  })
  .eq("ip_address", ip); // of op een andere key zoals domain
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

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert([{
        user_id,
        ip_address,
        page_url,
        timestamp: new Date().toISOString(),
        company_name: ipData.company_name,
        company_domain: ipData.company_domain,
        location: ipData.location,
        ip_street: ipData.ip_street,
        ip_postal_code: ipData.ip_postal_code,
        ip_city: ipData.ip_city,
        ip_country: ipData.ip_country,
        domain_address: ipData.domain_address,
        domain_postal_code: ipData.domain_postal_code,
        domain_city: ipData.domain_city,
        domain_country: ipData.domain_country,
        confidence_reason: ipData.confidence_reason || null,
        phone: ipData.phone || null,
  email: ipData.email || null,
  linkedin_url: ipData.linkedin_url || null,
  facebook_url: ipData.facebook_url || null,
  instagram_url: ipData.instagram_url || null,
  twitter_url: ipData.twitter_url || null,
  meta_description: ipData.meta_description || null,
        anon_id: req.body.anon_id || null,
    referrer: req.body.referrer || null,
    utm_source: req.body.utm_source || null,
    utm_medium: req.body.utm_medium || null,
    utm_campaign: req.body.utm_campaign || null,
    duration_seconds: req.body.duration_seconds || null
  category: ipData.category
      }])
      .select();

    if (error) {
      return res.status(500).json({ error: error.message || 'Database insert failed' });
    }

    const insertedRow = data[0];
    console.log('Inserted row:', insertedRow);

    if (ipData.company_name) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_TRACKING_DOMAIN || 'http://localhost:3000'}/api/kvk-lookup`, {

          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id: insertedRow.id,
            company_name: ipData.company_name
          })
        });
      } catch (err) {
        console.error('KvK lookup error:', err.message);
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
