// lib/fetchIpWebsite.js
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

/**
 * Stabiele fetch met timeout, geen auto-redirects.
 */
async function fetchWithTimeout(url, { timeout = 3000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      redirect: 'manual',  // we willen zelf de 'Location' header lezen
      signal: ctrl.signal
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Headers normaliseren:
 * - lowercase keys
 * - voor elke key altijd een array (multi-value veilig, bv. set-cookie)
 */
function normalizeHeaders(res) {
  const out = {};
  // node-fetch heeft .headers.raw() voor multi-value
  if (res && res.headers && typeof res.headers.raw === 'function') {
    const raw = res.headers.raw(); // { 'set-cookie': ['a','b'], 'location': ['...'] }
    for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = Array.isArray(v) ? v : [String(v)];
  } else if (res && res.headers) {
    for (const [k, v] of res.headers) out[String(k).toLowerCase()] = [String(v)];
  }
  return out;
}

/**
 * Parse simpele domeinkandidaten uit HTML: og:url en canonical
 */
function extractHtmlCandidates(html, baseUrl) {
  if (!html) return { ogUrl: null, canonical: null, htmlSnippet: null };
  const $ = cheerio.load(html);
  const ogUrl = $('meta[property="og:url"]').attr('content') || null;
  const canonical = $('link[rel="canonical"]').attr('href') || null;

  // meta refresh fallback: <meta http-equiv="refresh" content="0; URL=https://example.com/">
  const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
  let refreshUrl = null;
  if (metaRefresh) {
    const m = /url\s*=\s*['"]?([^'"]+)/i.exec(metaRefresh);
    if (m?.[1]) refreshUrl = m[1];
  }

  // Maak absoluut met base
  const absolutize = (u) => {
    try { return new URL(u, baseUrl).href; } catch { return null; }
  };

  return {
    ogUrl: ogUrl ? absolutize(ogUrl) : null,
    canonical: canonical ? absolutize(canonical) : null,
    refreshUrl: refreshUrl ? absolutize(refreshUrl) : null,
    htmlSnippet: html.slice(0, 2000) // houd snippet compact voor logging
  };
}

/**
 * Probeer domeinnaam te halen via HTTP(S) verzoek naar IP.
 * Retourneert ALTIJD een object met:
 *  {
 *    success, extracted_domain, headers, raw_html, robots_txt,
 *    confidence, confidence_reason, redirect_location, og_url, html_snippet, error_message
 *  }
 *
 * Let op:
 * - We proberen eerst HTTPS, daarna HTTP.
 * - We volgen geen redirects: we lezen de 'Location' header zelf uit.
 * - We geven headers/HTML/robots_txt terug zodat lead.js hier hints/signalen uit kan halen.
 */
export async function getDomainFromHttpIp(ip) {
  const baseLog = {
    success: false,
    extracted_domain: null,
    headers: null,
    raw_html: null,
    robots_txt: null,
    confidence: null,
    confidence_reason: null,
    redirect_location: null,
    og_url: null,
    html_snippet: null,
    error_message: null
  };

  const schemes = ['https', 'http'];

  for (const scheme of schemes) {
    const rootUrl = `${scheme}://${ip}/`;

    try {
      // 1) root ophalen (geen redirect volgen)
      const res = await fetchWithTimeout(rootUrl, { timeout: 3000 });
      const headers = normalizeHeaders(res);

      // 1a) Redirect? -> 'Location' kan meerdere waarden hebben, pak de eerste
      const loc = headers['location']?.[0];
      if (loc && loc.includes('.')) {
        try {
          const u = new URL(loc, rootUrl);
          return {
            ...baseLog,
            success: true,
            extracted_domain: u.hostname,
            headers,      // laat lead.js hier de hints uit lezen
            raw_html: null,
            robots_txt: null,
            confidence: 0.6,
            confidence_reason: 'HTTP redirect (Location header)',
            redirect_location: u.href,
            og_url: null,
            html_snippet: null,
            error_message: null
          };
        } catch {
          // ongeldige Location → gewoon door naar HTML
        }
      }

      // 2) HTML body lezen
      const html = await res.text().catch(() => '');
      const { ogUrl, canonical, refreshUrl, htmlSnippet } = extractHtmlCandidates(html, rootUrl);

      // 3) robots.txt ophalen (korte timeout)
      let robots_txt = null;
      try {
        const robots = await fetchWithTimeout(`${scheme}://${ip}/robots.txt`, { timeout: 2000 });
        robots_txt = await robots.text().catch(() => null);
      } catch {
        robots_txt = null;
      }

      // 4) beslis of we direct een domein kunnen claimen
      //    Voorkeursvolgorde: redirect > og:url > canonical > meta refresh
      const pick = (candidates) => candidates.find(Boolean);
      const chosen = pick([ogUrl, canonical, refreshUrl]);

      if (chosen) {
        try {
          const u = new URL(chosen);
          return {
            ...baseLog,
            success: true,
            extracted_domain: u.hostname,
            headers,
            raw_html: html,        // lead.js bewaart desnoods alleen snippet
            robots_txt,
            confidence: ogUrl ? 0.58 : (canonical ? 0.6 : 0.55),
            confidence_reason: ogUrl ? 'OG URL' : (canonical ? 'Canonical' : 'Meta refresh'),
            redirect_location: null,
            og_url: ogUrl || null,
            html_snippet: htmlSnippet,
            error_message: null
          };
        } catch {
          // chosen geen geldige URL → laat zonder extracted_domain verder
        }
      }

      // 5) (Fallback) zoek één absolute URL in HTML
      if (html) {
        const m = html.match(/https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z0-9-]{2,})/);
        if (m?.[1]) {
          return {
            ...baseLog,
            success: res.status > 0,
            extracted_domain: m[1].toLowerCase(),
            headers,
            raw_html: html,
            robots_txt,
            confidence: 0.55,
            confidence_reason: 'Absolute URL in HTML',
            redirect_location: null,
            og_url: ogUrl || null,
            html_snippet: htmlSnippet,
            error_message: null
          };
        }
      }

      // 6) Geen directe domein, maar we geven wel alles terug voor hints/signalen in lead.js
      return {
        ...baseLog,
        success: res.status > 0,
        extracted_domain: null,
        headers,
        raw_html: html,
        robots_txt,
        confidence: null,
        confidence_reason: null,
        redirect_location: null,
        og_url: ogUrl || null,
        html_snippet: htmlSnippet,
        error_message: null
      };

    } catch (err) {
      // probeer volgende scheme (http) als https faalt, of eindig met error als beiden falen
      if (scheme === schemes[schemes.length - 1]) {
        return { ...baseLog, error_message: err?.message || 'fetch error' };
      }
      // anders: loop door naar volgende scheme
    }
  }

  // Onbereikbaar normaal gesproken
  return baseLog;
}
