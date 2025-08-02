import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

/**
 * Probeer domeinnaam te halen via HTTP verzoek naar IP.
 * Returnt altijd een loggingobject, ook bij fouten.
 */
export async function getDomainFromHttpIp(ip) {
  const log = {
    ip_address: ip,
    success: false,
    extracted_domain: null,
    enrichment_source: null,
    confidence: null,
    confidence_reason: null,
    redirect_location: null,
    og_url: null,
    html_snippet: null,
    error_message: null,
  };

  try {
    const url = `http://${ip}`;
    const response = await fetch(url, { redirect: 'manual', timeout: 3000 });

    // Stap 1: check op redirect header
    const locationHeader = response.headers.get('location');
    if (locationHeader && locationHeader.includes('.')) {
      const hostname = new URL(locationHeader).hostname;
      log.success = true;
      log.extracted_domain = hostname;
      log.enrichment_source = 'http_redirect';
      log.confidence = 0.7;
      log.confidence_reason = 'Redirect Location header';
      log.redirect_location = locationHeader;
      return log;
    }

    // Stap 2: HTML uitlezen
    const html = await response.text();
    log.html_snippet = html.slice(0, 300); // bewaar eerste 300 tekens

    const $ = cheerio.load(html);

    // og:url
    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (ogUrl) {
      const hostname = new URL(ogUrl).hostname;
      log.success = true;
      log.extracted_domain = hostname;
      log.enrichment_source = 'og_url_meta';
      log.confidence = 0.75;
      log.confidence_reason = 'Meta og:url gevonden';
      log.og_url = ogUrl;
      return log;
    }

    // Stap 3: hardcoded link naar domein
    const domainMatch = html.match(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/);
    if (domainMatch) {
      log.success = true;
      log.extracted_domain = domainMatch[1];
      log.enrichment_source = 'html_content';
      log.confidence = 0.65;
      log.confidence_reason = 'Hardcoded domein in HTML';
      return log;
    }

    return log;
  } catch (err) {
    log.error_message = err.message;
    return log;
  }
}
