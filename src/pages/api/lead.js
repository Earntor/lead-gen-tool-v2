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
import net from 'node:net'; // service banner probes (SMTP/IMAP/POP3/FTP)

// ---- Minimal logger (stuurt debug weg in productie) ----
const DEBUG = process.env.ENRICH_DEBUG === '1';

const log = {
  dbg: (...args) => { if (DEBUG) console.debug(...args); },
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

// Opt-in vlag voor oude on-throttled co-host insert (default uit)
const DISABLE_UNTHROTTLED_COHOST_LOG = process.env.DISABLE_UNTHROTTLED_COHOST_LOG !== '0';
// Feature flags (DB-hits reduceren)
const HINT_SIGNAL_INLINE_LOG = process.env.HINT_SIGNAL_INLINE_LOG === '1';
const DISABLE_OBSERVED_FAVICON_LOG = process.env.DISABLE_OBSERVED_FAVICON_LOG === '1';
const ENABLE_SINGLE_EMAIL_HINT = process.env.ENABLE_SINGLE_EMAIL_HINT !== '0';


const require = createRequire(import.meta.url);
// END PATCH

const APP_PATH_PREFIXES = ["/login", "/dashboard", "/account"];


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

// === Normalisatie helpers ===
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function truncate(s, n) { return (typeof s === 'string' && s.length > n) ? s.slice(0, n) : s || null; }
function normText(s) { return (typeof s === 'string' ? s : '').trim() || null; }
function normName(s) {
  const t = normText(s);
  if (!t) return null;
  // collapse spaces, titlecase-achtig zonder te gek te doen
  const clean = t.replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\-.'&() ]/gu, '');
  return truncate(clean, 200);
}
function normEmail(s) {
  const t = (s || '').trim().toLowerCase();
  if (!t) return null;
  // simpele sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return null;
  return truncate(t, 255);
}
function normPhone(s) {
  const t = (s || '').replace(/[^\d+]/g, '');
  if (!t) return null;
  // minimaal 6 cijfers om rommel te vermijden
  const digits = t.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return truncate(t, 32);
}
function normUrl(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/\//, '');
  try {
    const url = new URL(s);
    // geen localhost / IP’s voor social links etc.
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)) return null;
    return truncate(url.toString(), 512);
  } catch { return null; }
}
function sameHostOrApex(urlStr, domain) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    return host === domain || host.endsWith('.' + domain);
  } catch { return false; }
}
// === EXTRA HINT HELPERS (nieuw) ==============================================

// 0) Max bytes voor HTML-scans (snel en veilig)
const MAX_HTML_BYTES = 150_000;

// A) Link: header → hosts uit rel=preload/preconnect/dns-prefetch
function parseLinkHeaderHosts(linkHeader) {
  const out = new Set();
  const s = Array.isArray(linkHeader) ? linkHeader.join(',') : String(linkHeader || '');
  const re = /<([^>]+)>;\s*rel="?(\w[\w-]*)"?/ig;
  let m; while ((m = re.exec(s))) {
    const rel = (m[2] || '').toLowerCase();
    if (!['preload','preconnect','dns-prefetch'].includes(rel)) continue;
    try {
      const h = new URL(m[1], 'https://x').hostname.toLowerCase();
      if (h && h.includes('.')) out.add(h);
    } catch {}
  }
  return [...out];
}

// B) Alt-Svc header → hosts
function parseAltSvcHosts(altSvc) {
  const out = new Set();
  const s = String(altSvc || '').toLowerCase();
  // voorbeelden: h3=":443"; ma=86400; persist=1; host="example.com"
  const re = /host="?([a-z0-9.-]+\.[a-z0-9-]{2,})"?/g;
  let m; while ((m = re.exec(s))) out.add(m[1]);
  return [...out];
}

// C) HTML <link rel="dns-prefetch|preconnect|preload"> → hosts
function parseHtmlRelHosts(html) {
  const out = { dns_prefetch: [], preconnect: [], preload: [] };
  if (!html) return out;
  const pick = (rel) => {
    const re = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]*href=["']([^"']+)["']`, 'ig');
    const set = new Set(); let m;
    while ((m = re.exec(html))) {
      try {
        const h = new URL(m[1], 'https://x').hostname.toLowerCase();
        if (h && h.includes('.')) set.add(h);
      } catch {}
    }
    return [...set];
  };
  out.dns_prefetch = pick('dns-prefetch');
  out.preconnect   = pick('preconnect');
  out.preload      = pick('preload');
  return out;
}

// D) E-mails in HTML → domeinen
function extractEmailDomains(html) {
  const set = new Set();
  if (!html) return [];
  const re = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/ig;
  let m; while ((m = re.exec(html))) set.add(m[1].toLowerCase());
  return [...set];
}

// E) Losse “bare” domeinen in HTML-tekst (voorzichtig; geen cdn/analytics)
function extractBareDomains(html) {
  const out = new Set();
  if (!html) return [];
  const re = /(?:[^a-z0-9@]|^)([a-z0-9.-]+\.[a-z0-9-]{2,})(?:[^a-z0-9.-]|$)/ig;
  let m; while ((m = re.exec(html))) {
    const d = (m[1] || '').toLowerCase();
    if (!d) continue;
    // skip duidelijke ruis
    if (/(^|\.)googleapis\.com$|(^|\.)gstatic\.com$|(^|\.)doubleclick\.net$|(^|\.)google-analytics\.com$/.test(d)) continue;
    out.add(d);
  }
  return [...out];
}

// F) Inline JS URL’s/host hints (window.API_URL, baseUrl, etc.)
function extractInlineJsHosts(html) {
  const out = new Set();
  if (!html) return [];
  const urlRe = /https?:\/\/([a-z0-9.-]+\.[a-z0-9-]{2,})[^\s"'<>)]*/ig;
  let m; while ((m = urlRe.exec(html))) out.add(m[1].toLowerCase());
  return [...out];
}

// G) Apple-touch icons & manifest → (p)hash, manifest host
async function fetchAppleAssets(ip) {
  // lazy import imghash (zelfde manier als pHash stap)
  let imghashMod; try { imghashMod = await import('imghash'); } catch { return { icons: [], manifestHost: null }; }
  const imghash = imghashMod.default || imghashMod;

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

  const ICON_PATHS = ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'];
  const icons = [];
  for (const scheme of ['https','http']) {
    for (const path of ICON_PATHS) {
      const buf = await fetchBuffer(`${scheme}://${ip}${path}`);
      if (!buf || buf.length < 64) continue;
      try {
        const phash = await imghash.hash(buf, 16, 'hex');
        const hex = buf.toString('hex').slice(0, 64); // snelle content-snapshot (geen echte cryptohash)
        icons.push({ path, phash, hex });
      } catch {}
    }
  }

  // manifest.json → host uit 'start_url' of icon src
  let manifestHost = null;
  for (const scheme of ['https','http']) {
    try {
      const txt = await fetchTextFast(`${scheme}://${ip}/manifest.json`, 2500);
      if (txt) {
        const j = JSON.parse(txt);
        const s = j.start_url || (Array.isArray(j.icons) && j.icons[0]?.src) || null;
        if (s) {
          try { manifestHost = new URL(s, `${scheme}://${ip}/`).hostname.toLowerCase(); } catch {}
        }
      }
    } catch {}
    if (manifestHost) break;
  }

  return { icons, manifestHost };
}

// H) “Default site” detectie om HTTP-signalen te downgraden
function isDefaultSite(html, headers) {
  const h = (html || '').toLowerCase();
  const server = String(headers?.server || '').toLowerCase();
  return (
    /welcome to nginx/.test(h) ||
    /apache2 ubuntu default page/.test(h) ||
    /plesk.*default/i.test(h) ||
    /cpanel/i.test(h) ||
    /traefik/i.test(h) ||
    /iis windows server/i.test(h) ||
    /test page for the http server/i.test(h) ||
    /default web site/i.test(h) ||
    /nginx/.test(server) || /apache/.test(server)
  );
}

// I) PTR woord→domein generator (+ kleine TLD-set)
const TOP_TLDS = ['nl','com','eu','net','be','de','fr','uk'];
function titleToSlug(s) {
  return String(s || '').toLowerCase()
    .replace(/&/g, ' en ')
    .replace(/[().,'"]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}
function generateDomainsFromPtr(ptrHost, cap = 20) {
  const base = stripSubdomain(ptrHost || '');
  if (!base) return [];
  const label = base.split('.').slice(0, -1).join('.') || base.split('.')[0] || '';
  const words = (label || '').replace(/[^a-z0-9-]/gi,' ').split(/\s+/).filter(Boolean);
  const variants = new Set();
  for (const w of words) {
    const raw = w.replace(/[^a-z0-9]/gi,'');
    if (raw.length < 3) continue;
    variants.add(raw);
    variants.add(raw.replace(/-/g,''));
  }
  const out = new Set();
  for (const v of variants) for (const tld of TOP_TLDS) out.add(`${v}.${tld}`);
  return [...out].slice(0, cap);
}

// J) AS-naam → domein kandidaten
function generateDomainsFromAsName(asname, cap = 12) {
  if (!asname) return [];
  let s = asname.toLowerCase();
  s = s.replace(/\b(bv|b\.v\.|nv|n\.v\.|gmbh|s\.a\.|s\.r\.l\.|ltd|limited|llc|inc|co|holding|groep|group|b\.v)\b/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return [];
  const slug = titleToSlug(s).replace(/-/g,'');
  if (slug.length < 3) return [];
  const out = new Set();
  for (const tld of TOP_TLDS) out.add(`${slug}.${tld}`);
  return [...out].slice(0, cap);
}

// K) Email SRV records → hosts; boost als host → dit IP resolve’t
async function emailSrvHints(domain, ip) {
  const kinds = ['_submission._tcp','_smtps._tcp','_imap._tcp','_imaps._tcp','_pop3._tcp','_pop3s._tcp'];
  const hosts = new Set();
  for (const k of kinds) {
    try {
      const recs = await dns.resolveSrv(`${k}.${domain}`);
      for (const r of (recs || [])) if (r?.name) hosts.add(stripSubdomain(r.name));
    } catch {}
  }
  const srvHosts = [...hosts];
  let pointsToIp = false;
  for (const h of srvHosts) {
    try {
      const a = await dns.resolve(h);
      if ((a || []).map(String).includes(ip)) { pointsToIp = true; break; }
    } catch {}
  }
  return { srvHosts, pointsToIp, scoreBoost: (srvHosts.length ? 0.05 : 0) + (pointsToIp ? 0.05 : 0) };
}

// === Category helpers (NL / "beter dan generic") ===
const GENERIC_TYPES = new Set(['establishment','point_of_interest','premise','geocode','plus_code','store','finance','health','food','lodging','school','university']);

function isBetterCategory(currentEn, currentNl, nextEn, nextNl) {
  const curIsGeneric = !currentEn || GENERIC_TYPES.has(String(currentEn).toLowerCase());
  const nextIsSpecific = !!nextEn && !GENERIC_TYPES.has(String(nextEn).toLowerCase());
  if (nextIsSpecific && curIsGeneric) return true; // specifieker dan generic → beter
  if (!currentNl && !!nextNl) return true;        // NL-vertaling ontbrak → beter
  return false;
}


// --- CSP helpers ---
function parseCspHosts(cspHeader) {
  const out = new Set();
  const s = (typeof cspHeader === 'string') ? cspHeader : Array.isArray(cspHeader) ? cspHeader.join('; ') : '';
  if (!s) return [];
  const directives = s.split(';');
  for (const d of directives) {
    const [name, ...rest] = d.trim().split(/\s+/);
    if (!name) continue;
    if (!/^(default-src|script-src|connect-src|img-src|media-src|frame-src|font-src|child-src|worker-src)$/i.test(name)) continue;
    for (const token of rest) {
      const t = token.trim().toLowerCase();
      if (!t || t === 'self' || t === 'none' || t === 'unsafe-inline' || t === 'unsafe-eval') continue;
      if (t === 'https:' || t === 'http:' || t.startsWith('data:') || t.startsWith('blob:') || t.startsWith('filesystem:')) continue;
      let host = t.replace(/^https?:\/\//, '').replace(/^\*\./, '');
      host = host.replace(/[^a-z0-9.-]/g, '');
      if (host && host.includes('.')) out.add(host);
    }
  }
  return [...out];
}

// --- Simple fetch text with timeout ---
async function fetchTextFast(url, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
  finally { clearTimeout(t); }
}

// --- Sitemap/security.txt brute op IP ---
async function bruteSitemapsOnIp(ip) {
  const paths = ['sitemap.xml', 'sitemap_index.xml', 'sitemap/sitemap.xml', '.well-known/security.txt'];
  const schemes = ['https', 'http'];
  const found = new Set();
  for (const scheme of schemes) {
    for (const p of paths) {
      const url = `${scheme}://${ip}/${p}`;
      const txt = await fetchTextFast(url);
      if (!txt) continue;
      const re = /https?:\/\/([a-z0-9.-]+\.[a-z0-9-]{2,})/ig;
      let m; while ((m = re.exec(txt))) { found.add(m[1].toLowerCase()); }
    }
  }
  return [...found];
}

// --- Domeinen uit banners knippen ---
function extractDomains(text) {
  const out = new Set();
  if (!text) return [];
  const re = /([a-z0-9.-]+\.[a-z0-9-]{2,})/ig;
  let m; while ((m = re.exec(text))) out.add(String(m[1]).toLowerCase());
  return [...out];
}

// --- Social normalisatie: alleen echte platformen toestaan ---
function filterSocial(url) {
  const u = normUrl(url);
  if (!u) return null;
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (/(^|\.)linkedin\.com$|(^|\.)facebook\.com$|(^|\.)instagram\.com$|(^|\.)twitter\.com$|(^|\.)x\.com$/.test(host)) {
      return u;
    }
  } catch {}
  return null;
}

// --- Service banner probing (SMTP/IMAP/POP3/FTP) ---
async function probeServiceBanners(ip) {
    const PORTS = [
    // e-mail/web/ftp die je had
    { port: 25,  tls: false, verb: 'EHLO', payload: 'EHLO probe.local\r\n' },
    { port: 587, tls: false, verb: 'EHLO', payload: 'EHLO probe.local\r\n' },
    { port: 2525,tls: false, verb: 'EHLO', payload: 'EHLO probe.local\r\n' },
    { port: 21,  tls: false, verb: 'FEAT', payload: 'FEAT\r\n' },
    { port: 110, tls: false, verb: 'QUIT', payload: 'QUIT\r\n' },
    { port: 995, tls: true,  verb: 'QUIT', payload: 'QUIT\r\n' },
    { port: 143, tls: false, verb: 'CAPA', payload: 'a1 CAPABILITY\r\n' },
    { port: 993, tls: true,  verb: 'CAPA', payload: 'a1 CAPABILITY\r\n' },

    // 🔥 aanvulling: SSH en hosting panels (soms lekken hostnames)
    { port: 22,  tls: false, verb: 'SSH', payload: '' },      // lees alleen banner
    { port: 2083,tls: true,  verb: 'Plesk/cPanel', payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 2087,tls: true,  verb: 'cPanel',       payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 2096,tls: true,  verb: 'cPanel',       payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 8443,tls: true,  verb: 'Plesk',        payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 8880,tls: false, verb: 'Plesk',        payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 7080,tls: false, verb: 'Panel',        payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 7081,tls: true,  verb: 'Panel',        payload: 'GET / HTTP/1.0\r\n\r\n' },

    // proxies/alt-web
    { port: 3128,tls: false, verb: 'HTTP',         payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 8008,tls: false, verb: 'HTTP',         payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 8081,tls: false, verb: 'HTTP',         payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 3001,tls: false, verb: 'HTTP',         payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 444, tls: true,  verb: 'HTTPS',        payload: 'GET / HTTP/1.0\r\n\r\n' },
    { port: 10443,tls: true, verb: 'HTTPS',        payload: 'GET / HTTP/1.0\r\n\r\n' },
  ];


  const results = [];
  const allDomains = new Set();

  for (const cfg of PORTS) {
    const { port, tls: useTls, verb, payload } = cfg;

    const banner = await new Promise((resolve) => {
      let sock;
      let buf = '';
      const done = (s) => { try { sock && sock.destroy(); } catch {} resolve(s); };

      const onData = (chunk) => {
        buf += chunk.toString('utf8');
        if (buf.length > 2048) done(buf.slice(0, 2048));
      };

      const onReady = () => {
        try { sock.write(payload); } catch {}
        setTimeout(() => done(buf), 600);
      };

      const opts = { host: ip, port, timeout: 2200 };
      sock = useTls
        ? tls.connect({ ...opts, rejectUnauthorized: false }, onReady)
        : net.connect(opts, onReady);

      sock.setTimeout(2200, () => done(buf));
      sock.on('data', onData);
      sock.on('error', () => done(buf));
      sock.on('end',  () => done(buf));
      sock.on('close',() => done(buf));
    });

    const snippet = (banner || '').slice(0, 2048);
    const rawDomains = extractDomains(snippet);
    const cleaned = [];
    for (const d of rawDomains) {
      const c = cleanAndValidateDomain(d, ENRICHMENT_SOURCES.SERVICE_BANNER, null, null, null, ip, null, null);
      if (c) { cleaned.push(c); allDomains.add(c); }
    }

    // --- service_banner_log: zuinig loggen (skip leeg, throttle 12u, alleen bij verandering) ---
try {
  const snippetNorm = (snippet || '').trim().slice(0, 512);     // compacte opslag
  const hasContent = !!snippetNorm || cleaned.length > 0;        // alleen loggen als er iets is
  if (!hasContent) {
    // niets te loggen
  } else {
    // laatste log voor dit ip+port ophalen
    const { data: prev } = await supabaseAdmin
      .from('service_banner_log')
      .select('id, created_at, banner_snippet, matched_domains')
      .eq('ip_address', ip)
      .eq('port', port)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const withinThrottle = (() => {
      if (!prev?.created_at) return false;
      const t = new Date(prev.created_at).getTime();
      return Number.isFinite(t) && (Date.now() - t) < (12 * 60 * 60 * 1000); // 12 uur
    })();

    const arrEq = (a, b) => {
      const A = Array.isArray(a) ? [...a].sort() : [];
      const B = Array.isArray(b) ? [...b].sort() : [];
      if (A.length !== B.length) return false;
      for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
      return true;
    };

    const prevSnippet = (prev?.banner_snippet || '').trim().slice(0, 512);
    const sameContent = arrEq(prev?.matched_domains, cleaned) && prevSnippet === snippetNorm;

    // alleen schrijven als buiten throttle OF inhoud echt anders is
    if (!withinThrottle || !sameContent) {
      await supabaseAdmin.from('service_banner_log').insert({
        ip_address: ip,
        port,
        tls: useTls,
        verb,
        banner_snippet: snippetNorm || null,
        matched_domains: cleaned.length ? cleaned : null
      });
    }
  }
} catch (e) {
  console.warn('⚠️ service_banner_log insert faalde:', e.message);
}


    results.push({ port, tls: useTls, verb, snippet, domains: cleaned });
  }

  return { results, allDomains: [...allDomains] };
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
  CACHE_REUSE: 'cache_reuse',
  SERVICE_BANNER: 'service_banner'

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
  CACHE_REUSE: 'Herbruikte domeinverrijking uit cache',
  SERVICE_BANNER: 'service_banner'
};

// Hostingproviders
const HOSTING_DOMAINS = [
  'sr-srv.net', 'dfn.nl', 'leaseweb.net', 'ovh.net', 'azure.com', 'amazonaws.com',
  'googleusercontent.com', 'linode.com', 'digitalocean.com', 'hetzner.de',
];

// Extra blacklist voor reverse DNS (consumenten en irrelevante domeinen)
const EXTRA_BLACKLIST_DOMAINS = [
  'kpn.net', 'ziggo.nl', 'ziggozakelijk.nl', 'glasoperator.nl', 't-mobilethuis.nl', 'chello.nl', '',
  'dynamic.upc.nl', 'vodafone.nl', 'versatel.nl', 'msn.com', 'akamaitechnologies.com',
  'telenet.be', 'proximus.be', 'myaisfibre.com', 'filterplatform.nl', 'xs4all.nl', 'home.nl', 'digimobil.es', 'solcon.nl', 'avatel.es',
  'weserve.nl', 'ubuntu-3ubuntu0.13', 'cosmote.net', 'orange.be', 'softether.net','mytrinet.ru','myqcloud.com', '8.9p1', '9.6p1', 'draytek.com', 'telenor.se','crawl.cloudflare.com', 'hide.me', 'hosted-by-vdsina.com', 'ssh-2.0-openssh', 'poneytelecom.eu', 'nextgenerationnetworks.nl', 'kabelnoord.net', 'googlebot.com','client.t-mobilethuis.nl', 'routit.net', 'starlinkisp.net', 'baremetal.scw.cloud','fbsv.net','sprious.com', 'your-server.de', 'vodafone.pt', 'ip.telfort.nl', 'amazonaws.com', 'dataproviderbot.com', 'apple.com', 'belgacom.be' 
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
    // Alles wat geen l osse kolom heeft bewaren we in JSONB 'signals'
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


// === ALT-HTTP HELPERS (NIEUW) ===
// Poorten die we extra proberen naast 80/443
const ALT_HTTP_PORTS = [8080, 8443, 8000, 8888, 3000, 5000, 7001, 9443];
const HTTPS_PORTS = new Set([443, 8443, 9443]);

// Kleine fetch naar IP:PORT met korte timeout en simpele domeinextractie
async function httpFetchIpPort(ip, port, timeoutMs = 3000) {
  const isHttps = HTTPS_PORTS.has(port);
  const url = `${isHttps ? 'https' : 'http'}://${ip}:${port}/`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const headers = Object.fromEntries([...res.headers.entries()].map(([k,v]) => [k.toLowerCase(), v]));
    let raw_html = '';
    try { raw_html = await res.text(); } catch { raw_html = ''; }

    // Heuristieken om een domein te vinden
    let extracted_domain = null;
    let confidence = 0.6;
    let confidence_reason = 'HTTP alt-port';

    // 1) Redirect Location → host
    const loc = headers['location'] || null;
    if (loc && !extracted_domain) {
      try {
        extracted_domain = new URL(loc, url).hostname;
        confidence = 0.65;
        confidence_reason = 'HTTP alt-port redirect';
      } catch {}
    }

    // 2) HTML canonical/og:url → host
    if (!extracted_domain && raw_html) {
      const canon = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i.exec(raw_html);
      const og    = /<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)/i.exec(raw_html);
      const h = (canon?.[1] || og?.[1]) || null;
      if (h) {
        try {
          extracted_domain = new URL(h, url).hostname;
          confidence = 0.62;
          confidence_reason = 'HTTP alt-port canonical/og';
        } catch {}
      }
    }

    return {
      success: true,
      port,
      headers,
      raw_html,
      redirect_location: loc || null,
      extracted_domain: extracted_domain || null,
      confidence,
      confidence_reason
    };
  } catch (e) {
    return {
      success: false,
      port,
      error_message: e.message || 'http alt-port error'
    };
  } finally {
    clearTimeout(timer);
  }
}

// Loop over de alt-poorten; log NIET meer per poort; stop bij eerste sterke hit
async function tryHttpOnAltPorts(ip) {
  for (const port of ALT_HTTP_PORTS) {
    const r = await httpFetchIpPort(ip, port);
    // Stop zodra we een domein te pakken hebben
    if (r.success && r.extracted_domain) {
      return r; // { success, port, extracted_domain, ... }
    }
  }
  return null; // geen hit
}



// === CNAME chain helper (NIEUW) ===
// Volgt CNAME-records tot maxDepth. Returnt { chain: [..], terminal, success, error }
async function resolveCnameChain(seed, maxDepth = 5) {
  const seen = new Set();
  const chain = [];
  let current = stripSubdomain(seed);
  if (!current) return { chain, terminal: null, success: false, error: 'invalid seed' };

  for (let i = 0; i < maxDepth; i++) {
    if (seen.has(current)) {
      return { chain, terminal: current, success: false, error: 'loop detected' };
    }
    seen.add(current);
    chain.push(current);

    // Probeer CNAME voor 'current'
    let cnames = [];
    try {
      cnames = await dns.resolveCname(current);
    } catch {
      // geen CNAME → klaar (terminal is current)
      return { chain, terminal: current, success: true, error: null };
    }

    const nxt = cnames?.[0] ? stripSubdomain(cnames[0]) : null;
    if (!nxt || nxt === current) {
      return { chain, terminal: current, success: true, error: null };
    }
    current = nxt;
  }
  return { chain, terminal: current, success: true, error: 'maxDepth reached' };
}

// === A/AAAA resolving helpers (NIEUW) ===

// resolve A + AAAA en check of één van de adressen gelijk is aan het target IP (v4/v6 safe)
async function domainResolvesToIp(domain, ip) {
  const matches = new Set();
  const target = String(ip).toLowerCase();

  const tryResolve = async (fn) => {
    try {
      const arr = await fn(domain);
      for (const a of (arr || [])) {
        const v = typeof a === 'string' ? a : (a?.address || a);
        if (!v) continue;
        if (String(v).toLowerCase() === target) matches.add(target);
      }
    } catch {}
  };

  await tryResolve(dns.resolve4);
  await tryResolve(dns.resolve6);

  return matches.size > 0;
}

// Check een beperkte set kandidaten (cap voor performance) en maak een kleine classificatie
async function computeCohostingHeuristics(ip, candidateDomains, maxCheck = 30) {
  // 1) fdns_lookup count (snapshot)
  let fdnsTotal = 0;
  try {
    const { count } = await supabaseAdmin
      .from('fdns_lookup')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip);
    fdnsTotal = typeof count === 'number' ? count : 0;
  } catch {}

  // 2) Live A/AAAA check over kandidaten (apex / uniek / gelimiteerd)
  const unique = Array.from(new Set((candidateDomains || []).filter(Boolean))).slice(0, maxCheck);
  const liveMatches = [];
  for (const d of unique) {
    const ok = await domainResolvesToIp(d, ip);
    if (ok) liveMatches.push(d);
  }

  // 3) Classificatie op basis van fdns_total
  let classification = 'unknown';
  if (fdnsTotal >= 50) classification = 'heavy-multitenant';
  else if (fdnsTotal >= 10) classification = 'moderate';
  else classification = 'low';

  return {
    fdnsTotal,
    liveChecked: unique.length,
    liveMatchCount: liveMatches.length,
    liveMatches,
    classification
  };
}

// Pas kleine penalty/boost toe op domainSignals (pure heuristiek, voorzichtig!)
function applyCohostingAdjustments(domainSignals, heur) {
  if (!Array.isArray(domainSignals) || domainSignals.length === 0) return { adjusted: domainSignals, applied: 0, reason: 'no signals' };

  // Basisregelset — heel kleine nudges
  let delta = 0;
  let reason = 'no change';

  if (heur.classification === 'heavy-multitenant') {
    // veel co-hosting => downgrade "zachte" bronnen een tikje
    delta = -0.07;
    reason = 'heavy multitenant penalty';
  } else if (heur.classification === 'moderate') {
    delta = -0.04;
    reason = 'moderate multitenant penalty';
  } else if (heur.classification === 'low' && heur.liveMatchCount > 0) {
    // weinig co-hosting + minstens 1 live match => mini-boost op hardere bronnen
    delta = +0.03;
    reason = 'low multitenant boost (live matches present)';
  }

  if (delta === 0) return { adjusted: domainSignals, applied: 0, reason };

  // Bronnen die we penaliseren of boosten
  const SOFT_SOURCES = new Set(['http_fetch', 'favicon_hash', 'host_header', 'website_scrape']);
  const HARD_SOURCES = new Set(['reverse_dns', 'tls_cert', 'final_likely']);

  const out = domainSignals.map(sig => {
    const s = { ...sig };

    // Alleen aanpassen als confidence numeriek is
    if (typeof s.confidence === 'number' && !Number.isNaN(s.confidence)) {
      let doAdjust = false;

      if (delta < 0) {
        // Penalty alleen voor "soft" bronnen
        if (SOFT_SOURCES.has(String(s.source))) doAdjust = true;
      } else {
        // Boost alleen voor "hard" bronnen, en als het domein in liveMatches zit
        if (HARD_SOURCES.has(String(s.source)) && heur.liveMatches.includes(s.domain)) doAdjust = true;
      }

      if (doAdjust) {
        const newVal = Math.max(0.05, Math.min(0.95, s.confidence + delta));
        if (newVal !== s.confidence) {
          s.confidence = newVal;
          s.confidence_reason = (s.confidence_reason ? s.confidence_reason + ' + ' : '') + reason;
        }
      }
    }

    return s;
  });

  return { adjusted: out, applied: delta, reason };
}


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

// ⛔️ HARD GUARD: enrichment nooit draaien zonder geldige page_url
  // of wanneer het om je eigen app-domein gaat.
  const APP_HOSTS = new Set([
    'lead-gen-tool-v2.vercel.app',
    'localhost',
    '127.0.0.1'
  ]);
  const safeUrl = (u) => { try { return new URL(String(u)); } catch { return null; } };
  

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

// Verzamel HTML-maildomeinen uit http_fetch (alleen content-based)
const contentEmailDomains = new Set();

  const parsed = safeUrl(page_url);
  // ongeldig of leeg → niet verrijken
  if (!parsed) {
    return res.status(200).json({ ignored: true, reason: 'invalid or missing page_url' });
  }
  // eigen app host → niet verrijken
  if (APP_HOSTS.has(parsed.hostname)) {
    return res.status(200).json({ ignored: true, reason: 'app host (dashboard/login/etc.)' });
  }
  // extra: als referrer óók je app is, skippen
  const ref = safeUrl(referrer);
  if (ref && APP_HOSTS.has(ref.hostname)) {
    return res.status(200).json({ ignored: true, reason: 'app referrer' });
  }

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


  // ⛔️ Skip ALLE app-bezoeken (host of bekende paden) – vóór welk heavy werk dan ook
try {
  const u = new URL(page_url || "");
  const host = (u.hostname || "").toLowerCase();
  const path = u.pathname || "/";

  const isAppHost = APP_HOSTS.has(host);
  const isAppPath = APP_PATH_PREFIXES.some(p => path.startsWith(p));

  if (isAppHost || isAppPath) {
    await markQueue('skipped', 'skipped: internal app visit');
    return res.status(200).json({ ignored: true, reason: "internal app visit" });
  }
} catch {
  // Ongeldige URL? Niks blokkeren; laat enrichment doorlopen voor echte sites
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
log.dbg('lead payload (trimmed)', {
  ip: req?.body?.ip_address,
  page_url: req?.body?.page_url,
  asn: req?.body?.asn || req?.body?.asname,
});


log.dbg('request', { ip: ip_address, org_id, page_url });

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
// ✅ Re-enrich ook als cache "fresh" is maar confidence laag is (< 0.70)
const needsDomainEnrichment =
  !cached
  || !cachedIsFresh
  || !cachedHasDomain
  || cached?.company_name === 'Testbedrijf'
  || (cachedHasDomain && (
       !cachedHasConfidence
       || (typeof cached.confidence === 'number' && cached.confidence < 0.70) // 👈 NIEUW
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
      let category_nl = null;
let place_id = null;
let place_types = null;

// ---- Gebatchte signal-helper ----
// forceLog=true => altijd 1-op-1 DB-log (voor harde signalen).
// HINT_SIGNAL_INLINE_LOG => alle signalen óók per stuk loggen (uit standaard).
async function addSignal({ ip_address, domain, source, confidence, confidence_reason, forceLog = false }) {
  if (!domain || !source) return null;

  const sig = {
    domain,
    source,
    confidence: (typeof confidence === 'number' && !Number.isNaN(confidence)) ? confidence : null,
    confidence_reason: confidence_reason || null
  };

  // Altijd toevoegen aan in-memory set (voor later combineren)
  domainSignals.push(sig);

  // Per-stuk DB-log alleen voor harde signalen of als expliciet aangezet
  if (forceLog || HINT_SIGNAL_INLINE_LOG) {
    try {
      await supabaseAdmin.from('domain_signal_log').insert({
        ip_address,
        signals: [sig],
        chosen_domain: null,
        enrichment_source: source,
        confidence: sig.confidence,
        confidence_reason: sig.confidence_reason,
        logged_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('⚠️ domain_signal (inline) insert faalde:', e.message);
    }
  }

  return sig;
}


// === PARALLEL STARTERS (nieuw) ==============================================
// Start trage, onafhankelijke calls meteen, zodat ze klaar zijn zodra we ze nodig hebben.
// Let op: we verwerken de resultaten later op de bestaande plekken.
const pTlsCert   = getTlsCertificateFromIp(ip_address).catch(() => null);
const pHttpFetch = getDomainFromHttpIp(ip_address).catch(() => ({ success: false, error_message: 'http fetch failed' }));
const pAltHttp   = tryHttpOnAltPorts(ip_address).catch(() => null);
// (Als je straks ook banners parallel wilt doen: const pBanners = probeServiceBanners(ip_address).catch(() => null);)
// ============================================================================ 


      // 🔁 Stap 2 – Reverse DNS → SIGNAL
      try {
        const hostnames = await dns.reverse(ip_address);
log.dbg('PTR hostnames (count=' + (hostnames?.length || 0) + ')');

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
log.dbg(`confidence te laag (${score}) — genegeerd`);
          continue;
        }

const signal = await addSignal({
  ip_address,
  domain: extracted,
  source: ENRICHMENT_SOURCES.RDNS,
  confidence: score,
  confidence_reason: reason,
  forceLog: true  // harde bron: 1-op-1 DB-log behoud
});

company_domain = extracted; // al gevalideerd door cleanAndValidateDomain
enrichment_source = ENRICHMENT_SOURCES.RDNS;
confidence = score;
confidence_reason = reason;
reverseDnsDomain = hostname;
used = true;
break;

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

// === PTR-candidate expansion (NIEUW) ===
// Bouw extra kandidaten op basis van RDNS: apex + www.apex
let ptrGenerated = [];
try {
  if (reverseDnsDomain) {
    // 1) schoonmaken → eTLD+1 (apex)
    const cleaned = stripSubdomain(reverseDnsDomain);  // bv. mail01.acme.nl -> acme.nl (stript service-labels)
    const parsed = psl.parse(cleaned || '');
    const apex = parsed && !parsed.error ? parsed.domain : null;

    // 2) maak de 2 kandidaten en valideer ze meteen
    if (apex) {
      for (const cand of [apex, `www.${apex}`]) {
        const v = cleanAndValidateDomain(
          cand,
          ENRICHMENT_SOURCES.RDNS,
          asname,
          org_id,
          page_url,
          ip_address,
          confidence,
          confidence_reason
        );
        if (v) ptrGenerated.push(v);
      }
    }
  }
} catch (e) {
  console.warn('⚠️ PTR-candidate expansion faalde:', e.message);
}

// === CNAME chain discovery (NIEUW) ===
// We nemen als seeds: de PTR-afgeleiden + (indien later niet beschikbaar) voegen we fdns in bij de host-probe stap
let cnameDerived = [];
try {
  const seeds = new Set(ptrGenerated || []);
  for (const seed of seeds) {
    const out = await resolveCnameChain(seed, 6);
    // Log altijd (audit)
    await supabaseAdmin.from('cname_chain_log').insert({
      ip_address,
      seed_domain: seed,
      chain: out.chain?.length ? out.chain : null,
      terminal: out.terminal || null,
      depth: Array.isArray(out.chain) ? out.chain.length : null,
      success: !!out.success,
      error_message: out.error || null
    });

    // Als terminaldomein bruikbaar is, normaliseer/valideer en voeg toe als kandidaat + licht signaal
    if (out.terminal) {
      const validated = cleanAndValidateDomain(
        out.terminal,
        ENRICHMENT_SOURCES.HOST_HEADER,   // CNAME helpt vooral voor HTTP host proef
        asname, org_id, page_url, ip_address,
        confidence, confidence_reason
      );
      if (validated) {
        cnameDerived.push(validated);

        // licht signaal — CNAME ≠ keiharde bevestiging, maar wel nuttig
        const sig = await logDomainSignal({
          ip_address,
          domain: validated,
          source: ENRICHMENT_SOURCES.HOST_HEADER,
          confidence: 0.52,
          confidence_reason: 'CNAME terminal'
        });
        if (sig) domainSignals.push(sig);
      }
    }
  }
} catch (e) {
  console.warn('⚠️ CNAME chain discovery faalde:', e.message);
}

// ⬇️ NIEUW: extra kandidaten uit PTR-woordvarianten en AS-naam
let ptrWordCandidates = [];
try {
  if (reverseDnsDomain) {
    ptrWordCandidates = generateDomainsFromPtr(reverseDnsDomain, 20)
      .map(d => cleanAndValidateDomain(
        d, ENRICHMENT_SOURCES.RDNS, asname, org_id, page_url, ip_address, confidence, confidence_reason
      ))
      .filter(Boolean);
  }
} catch (e) {
  console.warn('⚠️ PTR word→domain expansion faalde:', e.message);
}

let asNameCandidates = [];
try {
  if (asname) {
    asNameCandidates = generateDomainsFromAsName(asname, 12)
      .map(d => cleanAndValidateDomain(
        d, ENRICHMENT_SOURCES.RDNS, asname, org_id, page_url, ip_address, confidence, confidence_reason
      ))
      .filter(Boolean);
  }
} catch (e) {
  console.warn('⚠️ AS-naam kandidaten faalde:', e.message);
}



// 🔐 Stap 3 – TLS-certificaatinspectie → SIGNAL (audit-proof)
// BEGIN PATCH: TLS-cert alleen loggen bij échte hit
try {
    const certInfo = await pTlsCert; // ← gebruik parallel resultaat
  if (!certInfo) {
    // ⛔ Geen bruikbare cert-info → NIET loggen (stil overslaan)
  } else {
    let extracted = null;

    // 1) CN proberen
    if (certInfo.commonName?.includes('.')) {
      extracted = cleanAndValidateDomain(
        certInfo.commonName,
        ENRICHMENT_SOURCES.TLS,
        asname, org_id, page_url, ip_address,
        confidence, confidence_reason
      );
    }

    // 2) Anders: kortste SAN pakken
    if (!extracted && certInfo.subjectAltName) {
      const matches = certInfo.subjectAltName.match(/DNS:([A-Za-z0-9.-]+\.[A-Za-z0-9-]{2,})/g);
      if (matches?.length) {
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
      // ✅ Alleen bij succesvolle extractie → signaal + log used=true
await addSignal({
  ip_address,
  domain: extracted,
  source: ENRICHMENT_SOURCES.TLS,
  confidence: 0.75,
  confidence_reason: CONFIDENCE_REASONS.TLS,
  forceLog: true
});


      await supabaseAdmin.from('tls_log').insert({
        ip_address,
        common_name: certInfo.commonName || null,
        subject_alt_name: certInfo.subjectAltName || null,
        extracted_domain: extracted,
        used: true,
        confidence: 0.75,
        confidence_reason: CONFIDENCE_REASONS.TLS,
        enrichment_source: ENRICHMENT_SOURCES.TLS,
        checked_at: new Date().toISOString()
      });
    }
    // ⛔ Geen else-log: bij geen extractie loggen we niks
  }
} catch (e) {
  console.warn('⚠️ TLS-certificaat ophalen mislukt:', e.message);
  // ⛔ Geen DB-log bij exception (voorkomt ruis)
}
// END PATCH



    // 🌐 Stap 6 – HTTP fetch naar IP → SIGNAL
// ⬇️ VERVANG je hele try/catch-blok door dit:
try {
  const result = await pHttpFetch; // ← gebruik parallel resultaat

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

    // >>> EXTRA HINTS (dns-prefetch, link:, alt-svc, emails, bare domains, inline js, apple icons, default-site)
    const clippedHtml = html ? String(html).slice(0, MAX_HTML_BYTES) : '';

    // 1) HTML <link rel=...>
    const relHosts = parseHtmlRelHosts(clippedHtml);

    // 2) Response headers: Link, Alt-Svc
    const linkHeader = hdrs['link'] || null;
    const altSvc     = hdrs['alt-svc'] || null;
    const linkHosts  = parseLinkHeaderHosts(linkHeader);
    const altSvcHosts= parseAltSvcHosts(altSvc);

    // 3) E-mails / bare domains / inline JS URLs
    const emailDomains = extractEmailDomains(clippedHtml);
    for (const d of emailDomains) contentEmailDomains.add(d);
    const bareDomains  = extractBareDomains(clippedHtml);
    const jsHosts      = extractInlineJsHosts(clippedHtml);

    // 4) Extra headers met host hints
    const xServed  = hdrs['x-served-by'] ? String(hdrs['x-served-by']).toLowerCase() : '';
    const viaHdr   = hdrs['via'] ? String(hdrs['via']).toLowerCase() : '';
    const sTiming  = hdrs['server-timing'] ? String(hdrs['server-timing']).toLowerCase() : '';
    const xFwdHost = hdrs['x-forwarded-host'] ? String(hdrs['x-forwarded-host']).toLowerCase() : '';

    const headerHosts = new Set();
    [xServed, viaHdr, sTiming, xFwdHost].forEach(s => {
      const matches = extractDomains(s);
      for (const d of matches) headerHosts.add(d);
    });

    // 5) Apple-touch icons & manifest host
    let appleIconItems = [];
    let manifestHost = null;
    try {
      const assets = await fetchAppleAssets(ip_address);
      appleIconItems = assets.icons || [];
      manifestHost = assets.manifestHost || null;
    } catch {}

    // Hints updaten in dezelfde http_fetch_log rij (merge met bestaande keys)
    if (httpFetchInsertId) {
      const extraHints = {
        dns_prefetch_hosts: relHosts.dns_prefetch?.length ? relHosts.dns_prefetch : null,
        preconnect_hosts:   relHosts.preconnect?.length ? relHosts.preconnect : null,
        preload_hosts:      relHosts.preload?.length ? relHosts.preload : null,
        link_header_hosts:  linkHosts.length ? linkHosts : null,
        alt_svc_hosts:      altSvcHosts.length ? altSvcHosts : null,
        email_domains_in_html: emailDomains.length ? emailDomains : null,
        bare_domains_in_html:  bareDomains.length ? bareDomains : null,
        inline_js_hosts:       jsHosts.length ? jsHosts : null,
        header_hint_hosts:     headerHosts.size ? [...headerHosts] : null,
        apple_icons:           appleIconItems.length ? appleIconItems : null,
        manifest_host:         manifestHost || null
      };
      await supabaseAdmin.from('http_fetch_log')
        .update({ hints: { ...(result.hints || {}), ...extraHints } })
        .eq('id', httpFetchInsertId);
    }

    // Signalen schrijven voor ALLE gevonden hosts/domeinen (lage/medium confidence)
    const hintDomains = new Set([
      ...relHosts.dns_prefetch, ...relHosts.preconnect, ...relHosts.preload,
      ...linkHosts, ...altSvcHosts,
      ...emailDomains, ...bareDomains, ...jsHosts,
      ...headerHosts
    ]);
    if (manifestHost) hintDomains.add(manifestHost);

    for (const raw of hintDomains) {
  const cand = cleanAndValidateDomain(
    raw, ENRICHMENT_SOURCES.HTTP_FETCH, asname, org_id, page_url, ip_address, confidence, confidence_reason
  );
  if (!cand) continue;

  await addSignal({
    ip_address,
    domain: cand,
    source: ENRICHMENT_SOURCES.HTTP_FETCH,
    confidence: 0.53,
    confidence_reason: 'HTML/headers hint'
  });
}



    // Apple-icon pHash/“hash”: upserten in favicon_hash_map + signaal
    for (const item of appleIconItems) {
      const phash = item.phash || null;
      const hex   = item.hex || null;
      if (!phash) continue;

      const syntheticKey = `ai_${phash}`;
      await supabaseAdmin.from('favicon_hash_map').upsert({
        hash: syntheticKey,
        phash: phash,
        domain: null,
        confidence: 0.5,
        source: 'apple_icon',
        last_seen: new Date().toISOString()
      }, { onConflict: 'hash' });

      await supabaseAdmin.from('favicon_hash_log').insert({
        ip_address, favicon_phash: phash, matched_domain: null, used: false,
        confidence: null, confidence_reason: 'Apple icon observed'
      });
    }

    // Default-site detectie → downgrade HTTP-signalen
    if (isDefaultSite(clippedHtml, hdrs)) {
      domainSignals = domainSignals.map(s => {
        if (s.source === ENRICHMENT_SOURCES.HTTP_FETCH && typeof s.confidence === 'number') {
          return { ...s, confidence: Math.max(0.05, s.confidence - 0.08),
            confidence_reason: (s.confidence_reason ? s.confidence_reason + ' + ' : '') + 'default site' };
        }
        return s;
      });
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
      await addSignal({
  ip_address,
  domain: cand,
  source: ENRICHMENT_SOURCES.HTTP_FETCH,
  confidence: 0.58,
  confidence_reason: 'Set-Cookie Domain'
});

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

    await addSignal({
  ip_address,
  domain: cand,
  source: ENRICHMENT_SOURCES.HTTP_FETCH,
  confidence: 0.55,
  confidence_reason: 'CORS allow-origin'
});

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
      await addSignal({
  ip_address,
  domain: cand,
  source: ENRICHMENT_SOURCES.HTTP_FETCH,
  confidence: 0.6,
  confidence_reason: 'HTML canonical/og'
});

    }
    // 3d) CSP header(s) → hosts
    try {
      const cspHeader = hdrs['content-security-policy'] || hdrs['content-security-policy-report-only'] || null;
      let cspHosts = [];
      if (cspHeader) {
        const raw = parseCspHosts(cspHeader);
        for (const h of raw) {
          const cand = cleanAndValidateDomain(
            h, ENRICHMENT_SOURCES.HTTP_FETCH, asname, org_id, page_url, ip_address, confidence, confidence_reason
          );
          if (!cand) continue;
          cspHosts.push(cand);
          await addSignal({
  ip_address,
  domain: cand,
  source: ENRICHMENT_SOURCES.HTTP_FETCH,
  confidence: 0.54,
  confidence_reason: 'CSP host'
});

        }
      }

      // 3e) Sitemap/security.txt brute → hosts
      let bruteHosts = [];
      try {
        const rawHosts = await bruteSitemapsOnIp(ip_address);
        for (const h of rawHosts) {
          const cand = cleanAndValidateDomain(
            h, ENRICHMENT_SOURCES.HTTP_FETCH, asname, org_id, page_url, ip_address, confidence, confidence_reason
          );
          if (!cand) continue;
          bruteHosts.push(cand);
          await addSignal({
  ip_address,
  domain: cand,
  source: ENRICHMENT_SOURCES.HTTP_FETCH,
  confidence: 0.56,
  confidence_reason: 'Sitemap/security.txt host'
});

        }
      } catch (e) {
        console.warn('⚠️ sitemap brute faalde:', e.message);
      }

      // Hintveld uitbreiden in dezelfde http_fetch_log rij
      if (httpFetchInsertId) {
        await supabaseAdmin.from('http_fetch_log')
          .update({
            hints: {
              set_cookie_domains: setCookieDomains.length ? setCookieDomains : null,
              allow_origins: allowOrigins.length ? allowOrigins : null,
              canonical_host: canonicalHost || null,
              og_url_host: ogHost || null,
              manifest_url: manifestUrl || null,
              sitemap_urls: sitemapUrls.length ? sitemapUrls : null,
              csp_hosts: cspHosts.length ? [...new Set(cspHosts)] : null,
              sitemap_bruteforce_hosts: bruteHosts.length ? [...new Set(bruteHosts)] : null
            }
          })
          .eq('id', httpFetchInsertId);
      }
    } catch (e) {
      console.warn('⚠️ CSP/sitemap hints verwerken faalde:', e.message);
    }
  } catch (hintErr) {
    console.warn('⚠️ header/html hints parsing faalde:', hintErr.message);
  }

  // bestaand gedrag: direct signaal als extractedDomain er al is
  if (result.success && extractedDomain) {
  await addSignal({
    ip_address,
    domain: extractedDomain,
    source: ENRICHMENT_SOURCES.HTTP_FETCH,
    confidence: result.confidence || 0.6,
    confidence_reason: result.confidence_reason || CONFIDENCE_REASONS.HTTP_FETCH,
    forceLog: true
  });
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

// 🔁 ALT-HTTP POORTEN (NIEUW) — ná de gewone HTTP fetch
try {
  const alt = await pAltHttp; // ← gebruik parallel resultaat
  if (alt?.extracted_domain) {
    const cleaned = cleanAndValidateDomain(
      alt.extracted_domain,
      ENRICHMENT_SOURCES.HTTP_FETCH,
      asname,
      org_id,
      page_url,
      ip_address,
      confidence,
      confidence_reason
    );
    if (cleaned) {
      await addSignal({
  ip_address,
  domain: cleaned,
  source: ENRICHMENT_SOURCES.HTTP_FETCH,
  confidence: alt.confidence || 0.62,
  confidence_reason: alt.confidence_reason || 'HTTP alt-port'
  // géén forceLog → minder writes
});

      // LET OP: geen insert in http_fetch_log hier — bewust stil (geen spam)
    }
  }
} catch (e) {
  console.warn('⚠️ ALT-HTTP ports probe faalde:', e.message);
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
      if (!DISABLE_OBSERVED_FAVICON_LOG) {
  // onbekende hash registreren (optioneel)
  {
    const upsertRes = await supabaseAdmin
      .from('favicon_hash_map')
      .upsert({
        hash,
        domain: null,
        confidence: 0.5,
        source: 'observed',
        last_seen: new Date().toISOString()
      }, { onConflict: 'hash' });
    if (upsertRes.error) {
      console.warn('⚠️ favicon_hash_map upsert (observed) error:', upsertRes.error.message, upsertRes.error.details || '');
    }
  }

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
      if (!DISABLE_OBSERVED_FAVICON_LOG) {
  await supabaseAdmin.from('favicon_hash_log').insert({
    ip_address,
    favicon_phash: phash,
    matched_domain: null,
    used: false
  });
  await supabaseAdmin
    .from('favicon_hash_map')
    .upsert(
      {
        hash: match?.hash ?? `ph_${phash}`,
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
  }
} catch (e) {
  console.warn('⚠️ favicon pHash faalde:', e.message);
}
// END PATCH

// 🛰️ Stap — Service banner probing → SIGNALS
try {
  const banners = await probeServiceBanners(ip_address);
  if (banners?.allDomains?.length) {
    for (const d of banners.allDomains) {
      await addSignal({
  ip_address,
  domain: d,
  source: ENRICHMENT_SOURCES.SERVICE_BANNER,
  confidence: 0.58,
  confidence_reason: CONFIDENCE_REASONS.SERVICE_BANNER
});
    }
  }
} catch (e) {
  console.warn('⚠️ service banner probing faalde:', e.message);
}


    // 🧪 Stap 8 – Host header probing → SIGNAL
// 🧪 Stap 8 – Host header probing → SIGNAL (stil, alleen succes loggen)
try {
  const { data: fdnsResults } = await supabaseAdmin
    .from('fdns_lookup')
    .select('domain')
    .eq('ip', ip_address);

  const domainsToTry = [
    ...(fdnsResults?.map(r => r.domain).filter(Boolean) || []),
    ...ptrGenerated,
    ...cnameDerived,
    ...ptrWordCandidates,
    ...asNameCandidates
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 12);

  if (domainsToTry.length > 0) {
    const result = await probeHostHeader(ip_address, domainsToTry, {
      timeoutMs: 3000,
      requireBranding: true,
      maxTrials: 0 // NIET terugloggen per trial
    });

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
          confidence: result.confidence || 0.85,
          confidence_reason: result.reason || CONFIDENCE_REASONS.HOST_HEADER
        });
        if (signal) domainSignals.push(signal);

        // ✅ Eén enkele audit-rij — ALLEEN bij succes
        await supabaseAdmin.from('host_probe_log').insert({
          ip_address,
          tested_domain: cleanedDomain,
          status_code: (typeof result.status_code === 'number') ? result.status_code : 200,
          content_snippet: result.snippet ? result.snippet.slice(0, 500) : null,
          success: true
        });
      }
    }

    // ❌ GEEN per-trial logging meer
    // ❌ GEEN extra "generated:true" marker-rows meer
  }
} catch (e) {
  console.warn('⚠️ Host header probing faalde:', e.message);
}


// Email-SRV hints op topkandidaten (max 10) → kleine boost + cache
try {
  const candidateDomains = [...new Set(domainSignals.map(s => s.domain).filter(Boolean))].slice(0, 10);
  for (const cand of candidateDomains) {
    const hints = await emailSrvHints(cand, ip_address);

    if (hints.srvHosts?.length) {
      // cache SRV in domain_enrichment_cache.email_dns (merge)
      const { data: existing } = await supabaseAdmin
        .from('domain_enrichment_cache')
        .select('email_dns')
        .eq('company_domain', cand)
        .maybeSingle();

      const merged = {
        ...(existing?.email_dns || {}),
        srv_hosts: hints.srvHosts
      };

      await supabaseAdmin.from('domain_enrichment_cache').upsert({
        company_domain: cand,
        email_dns: merged,
        email_dns_checked_at: new Date().toISOString()
      });
    }

    if (hints.scoreBoost > 0) {
      const sig = await logDomainSignal({
        ip_address, domain: cand, source: ENRICHMENT_SOURCES.HTTP_FETCH,
        confidence: Math.min(0.2, hints.scoreBoost),
        confidence_reason: 'Email SRV correlation'
      });
      if (sig) domainSignals.push(sig);
    }
  }
} catch (e) {
  console.warn('⚠️ email SRV hints faalde:', e.message);
}


// 🔐 EXTRA stap — TLS SNI probe (shared IP bevestigen)
// Plakken: ná host header probing, vóór "✅ Stap 9 – Combineer signalen"
// 🔐 EXTRA stap — TLS SNI probe (ports 443/8443/9443)
try {
  // 1) Kandidaten: fdns_lookup + alle domeinen uit signalen
  const { data: fdnsResults } = await supabaseAdmin
    .from('fdns_lookup')
    .select('domain')
    .eq('ip', ip_address);

  const seed = (fdnsResults || []).map(r => r.domain).filter(Boolean);
  const fromSignals = domainSignals.map(s => s.domain).filter(Boolean);
  const sniCandidates = [...new Set([...seed, ...fromSignals])].slice(0, 10); // max 10 voor snelheid

  // ✅ Nieuw: naast 443 ook 8443 en 9443 proberen
  const SNI_PORTS = [443, 8443, 9443];

  for (const cand of sniCandidates) {
    const tested = cleanAndValidateDomain(
      cand,
      ENRICHMENT_SOURCES.TLS,
      asname, org_id, page_url, ip_address,
      confidence, confidence_reason
    );
    if (!tested) continue;

    for (const port of SNI_PORTS) {
      // 2) TLS-handshake met SNI = tested (het kandidaat-domein)
      const cert = await new Promise((resolve) => {
        const socket = tls.connect({
          host: ip_address,
          port,
          servername: tested,          // ← SNI
          rejectUnauthorized: false,   // alleen cert lezen
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

      // 3) Check of cert dit domein dekt (CN of SAN)
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

      // 4) Altijd loggen in tls_log (inclusief poort en tested_domain)
      await supabaseAdmin.from('tls_log').insert({
        ip_address,
        port,
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

      // 5) Bij hit → signaal toevoegen en niet ook nog andere poorten voor deze kandidaat proberen
      if (covers) {
        const sig = await logDomainSignal({
          ip_address,
          domain: tested,
          source: ENRICHMENT_SOURCES.TLS,
          confidence: 0.75,
          confidence_reason: 'TLS SNI confirm'
        });
        if (sig) domainSignals.push(sig);
        break; // volgende kandidaat
      }
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
      try { const a = await dns.resolve4(h); if (a?.map(String).includes(ip)) mxPointsToIp = true; } catch {}
try { const a6 = await dns.resolve6(h); if (a6?.map(String).includes(ip)) mxPointsToIp = true; } catch {}

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

// === Co-hosting heuristics (NIEUW) ===
try {
  // Kandidaten die iets zeggen over "wie hoort hier bij": alles wat we al zagen
  const candidateDomains = [
    ...new Set([
      ...domainSignals.map(s => s.domain).filter(Boolean),
      ...(ptrGenerated || []),
      ...(cnameDerived || [])
    ])
  ].slice(0, 30);

  const heur = await computeCohostingHeuristics(ip_address, candidateDomains, 30);

 // Audit loggen (unthrottled) – standaard UIT via env-vlag
if (!DISABLE_UNTHROTTLED_COHOST_LOG) {
  try {
    await supabaseAdmin.from('ip_cohost_log').insert({
      ip_address,
      fdns_total: heur.fdnsTotal,
      live_checked: heur.liveChecked,
      live_match_count: heur.liveMatchCount,
      live_matches: heur.liveMatches.length ? heur.liveMatches : null,
      classification: heur.classification,
      penalty_applied: (heur.classification === 'heavy-multitenant') ? -0.07
                       : (heur.classification === 'moderate') ? -0.04
                       : (heur.classification === 'low' && heur.liveMatchCount > 0) ? 0.03
                       : 0,
      reason: (heur.classification === 'heavy-multitenant') ? 'many fdns domains'
             : (heur.classification === 'moderate') ? 'some fdns domains'
             : (heur.classification === 'low' && heur.liveMatchCount > 0) ? 'low cohosting + live match'
             : 'no change'
    });
  } catch (e) {
    log.warn('unthrottled cohost log failed (ignored):', e?.message);
  }
}


// --- Co-hosting audit logging: zuinig & alleen bij betekenisvolle wijziging ---
try {
  // 1) “Lege” snapshots overslaan (alles 0 → geen waarde)
  const emptySnapshot =
    (heur.fdnsTotal === 0) &&
    (heur.liveChecked === 0) &&
    (heur.liveMatchCount === 0);

  if (!emptySnapshot) {
    // 2) Laatste log voor dit IP ophalen (voor throttle/diff)
    const { data: prevRow } = await supabaseAdmin
      .from('ip_cohost_log')
      .select('checked_at, fdns_total, live_checked, live_match_count, classification, penalty_applied')
      .eq('ip_address', ip_address)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3) Throttle van 6 uur
    let withinThrottle = false;
    if (prevRow?.checked_at) {
      const last = new Date(prevRow.checked_at).getTime();
      withinThrottle = Number.isFinite(last) && (Date.now() - last) < (6 * 60 * 60 * 1000);
    }

    // 4) Betekenisvolle wijzigingen bepalen
    const prevFdns     = Number(prevRow?.fdns_total ?? 0);
    const prevLive     = Number(prevRow?.live_match_count ?? 0);
    const prevClass    = String(prevRow?.classification ?? 'unknown');
    const prevPenalty  = Number(prevRow?.penalty_applied ?? 0);

    const penaltyNow = (heur.classification === 'heavy-multitenant') ? -0.07
                    : (heur.classification === 'moderate')          ? -0.04
                    : (heur.classification === 'low' && heur.liveMatchCount > 0) ? 0.03
                    : 0;

    const bigFdnsJump     = Math.abs(heur.fdnsTotal - prevFdns) >= 5; // sprong ≥ 5
    const liveChanged     = heur.liveMatchCount !== prevLive;
    const classChanged    = String(heur.classification) !== prevClass;
    const penaltyChanged  = penaltyNow !== prevPenalty;

    const meaningfulChange = bigFdnsJump || liveChanged || classChanged || penaltyChanged;

    // 5) Alleen loggen als (a) buiten throttle, of (b) betekenisvolle wijziging
    if (!withinThrottle || meaningfulChange) {
      await supabaseAdmin.from('ip_cohost_log').insert({
        ip_address,
        fdns_total: heur.fdnsTotal,
        live_checked: heur.liveChecked,
        live_match_count: heur.liveMatchCount,
        live_matches: heur.liveMatches.length ? heur.liveMatches : null,
        classification: heur.classification,
        penalty_applied: penaltyNow,
        reason: (heur.classification === 'heavy-multitenant') ? 'many fdns domains'
              : (heur.classification === 'moderate')          ? 'some fdns domains'
              : (heur.classification === 'low' && heur.liveMatchCount > 0) ? 'low cohosting + live match'
              : 'no change'
      });
    }
    // binnen throttle én geen meaningfulChange → niets loggen
  }

  // 6) Signalen licht bijsturen (dit liet je al doen)
  const { adjusted, applied, reason } = applyCohostingAdjustments(domainSignals, heur);
  domainSignals = adjusted;
  if (applied !== 0) log.dbg(`cohosting adjust: ${applied} (${reason})`);
} catch (e) {
  console.warn('⚠️ ip_cohost_log logging faalde:', e.message);
}


  // Signalen licht bijsturen
} catch (e) {
  console.warn('⚠️ co-hosting heuristics faalde:', e.message);
}


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
  if (likely?.breakdown) {
  log.dbg('voting breakdown', {
  chosen: likely.domain,
  hardCount: likely.breakdown.hardCount,
  hardMax: likely.breakdown.hardMax,
  diversityBonus: likely.breakdown.diversityBonus
});

}


  if (likely?.domain) {
    const freqBoost = await calculateConfidenceByFrequency(ip_address, likely.domain);
    if (freqBoost && freqBoost.confidence > likely.confidence) {
      likely.confidence = freqBoost.confidence;
      likely.confidence_reason = freqBoost.reason;
log.dbg('confidence freq boost', freqBoost);
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
log.info(`blocked by cleanAndValidateDomain: ${likely.domain}`);
  await markQueue('skipped', 'skipped: blocked by cleanAndValidateDomain');
  return res.status(200).json({ ignored: true, reason: 'blocked by cleanAndValidateDomain' });
}


    company_domain = validatedLikely;
    enrichment_source = likely.enrichment_source || ENRICHMENT_SOURCES.FINAL_LIKELY;
    confidence = likely.confidence;
    confidence_reason = likely.confidence_reason;

log.info('chosen domain', company_domain);

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
  } 
  
  // --- SIGNAL FLOOR: bewaar de gecombineerde signalen-score als ondergrens ---
let signals_base_confidence = null;
if (typeof likely?.confidence === 'number' && !Number.isNaN(likely.confidence)) {
  signals_base_confidence = likely.confidence;
}
  
  else {
log.info('no domain from signals');

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

// === Single-email-hint (LAST RESORT) =========================================
// Alleen proberen als:
//  - er nog géén company_domain is gekozen
//  - de feature flag aan staat
//  - we in HTML precies één uniek e-maildomein zagen
try {
  if (ENABLE_SINGLE_EMAIL_HINT && !company_domain && contentEmailDomains.size === 1) {
    const soleEmailDomainRaw = [...contentEmailDomains][0];

    const cand = cleanAndValidateDomain(
      soleEmailDomainRaw,
      ENRICHMENT_SOURCES.HTTP_FETCH,
      asname, org_id, page_url, ip_address,
      /* confidence */ null,
      /* reason     */ null
    );

    if (cand) {
      // Voeg één extra, iets sterkere hint toe (boven je bestaande 0.53 HTML-hints)
      await addSignal({
        ip_address,
        domain: cand,
        source: ENRICHMENT_SOURCES.HTTP_FETCH,
        confidence: 0.55,
        confidence_reason: 'single email hint (last resort)'
        // géén forceLog → houdt DB rustig
      });

      // Nu opnieuw stemmen met de extra hint
      let fallbackLikely = null;
      if (domainSignals.length > 0) {
        fallbackLikely = getLikelyDomainFromSignals(domainSignals);
      }

      // Mini-boosts zoals eerder (frequentie + confirmed-by-form) opnieuw toepassen
      if (fallbackLikely?.domain) {
        const fb = await calculateConfidenceByFrequency(ip_address, fallbackLikely.domain);
        if (fb && fb.confidence > (fallbackLikely.confidence ?? 0)) {
          fallbackLikely.confidence = fb.confidence;
          fallbackLikely.confidence_reason = (fallbackLikely.confidence_reason ? fallbackLikely.confidence_reason + ' + ' : '') + fb.reason;
        }

        try {
          const q1 = await supabaseAdmin
            .from('form_submission_log')
            .select('id', { count: 'exact', head: true })
            .eq('ip', ip_address)
            .eq('domain', fallbackLikely.domain);
          const count1 = (q1 && typeof q1.count === 'number') ? q1.count : 0;

          const q2 = await supabaseAdmin
            .from('form_submission_log')
            .select('id', { count: 'exact', head: true })
            .eq('ip', ip_address)
            .ilike('email', `%@${fallbackLikely.domain}`);
          const count2 = (q2 && typeof q2.count === 'number') ? q2.count : 0;

          if ((count1 + count2) > 0) {
            fallbackLikely.confidence = Math.max(fallbackLikely.confidence ?? 0, 0.8);
            fallbackLikely.confidence_reason =
              (fallbackLikely.confidence_reason ? fallbackLikely.confidence_reason + ' + ' : '') + 'confirmed by form';
          }
        } catch (e) {
          console.warn('⚠️ confirmed-by-form (fallback) check faalde:', e.message);
        }

        // Valideer, kies en log
        const validated = cleanAndValidateDomain(
          fallbackLikely.domain,
          ENRICHMENT_SOURCES.FINAL_LIKELY,
          asname, org_id, page_url, ip_address,
          fallbackLikely.confidence,
          fallbackLikely.confidence_reason
        );

        if (validated) {
          company_domain = validated;
          enrichment_source = fallbackLikely.enrichment_source || ENRICHMENT_SOURCES.FINAL_LIKELY;
          confidence = fallbackLikely.confidence ?? 0.55;
          confidence_reason = fallbackLikely.confidence_reason
            ? fallbackLikely.confidence_reason + ' + single email hint'
            : 'single email hint';

          // Audit: aparte rij zodat duidelijk is dat dit een fallback was
          await supabaseAdmin.from('domain_signal_log').insert({
            ip_address,
            signals: domainSignals,
            chosen_domain: company_domain,
            enrichment_source,
            confidence,
            confidence_reason,
            site_id: site_id || null,
            page_url: page_url || null
          });
        }
      }
    }
  }
} catch (e) {
  console.warn('⚠️ single-email-hint fallback faalde:', e.message);
}
// ============================================================================


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
log.dbg('reuse ip_enrichment_cache', {
  hasPhone: !!domainCache?.phone,
  hasEmail: !!domainCache?.email,
  hasSocial: !!(domainCache?.linkedin_url || domainCache?.facebook_url || domainCache?.instagram_url || domainCache?.twitter_url),
  hasMeta: !!domainCache?.meta_description
});

        domain_lat = domainCache.lat || null;
        domain_lon = domainCache.lon || null;
        phone = domainCache.phone || null;
        email = domainCache.email || null;
        linkedin_url = domainCache.linkedin_url || null;
        facebook_url = domainCache.facebook_url || null;
        instagram_url = domainCache.instagram_url || null;
        twitter_url = domainCache.twitter_url || null;
        meta_description = domainCache.meta_description || null;
        // ✅ Reuse mag nooit downgraden: neem de max met wat we al hadden
{
  const reusedConf =
    (typeof domainCache.auto_confidence === 'number' ? domainCache.auto_confidence : null) ??
    (typeof domainCache.confidence === 'number' ? domainCache.confidence : null);

  if (typeof reusedConf === 'number') {
    confidence = Math.max(typeof confidence === 'number' ? confidence : 0, reusedConf);
  }

  // Alleen reden bijvullen als we er nog geen (betere) hebben
  if (!confidence_reason) {
    confidence_reason = domainCache.auto_confidence_reason || domainCache.confidence_reason || null;
  }
}


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
// 👉 Vul telefoon/e-mail vanuit Places, maar alleen als we ze nog niet hebben.
// (Scrape mag later nog invullen/overrulen; zie Patch B.)
try {
  if (domainEnrichment) {
    if (phone == null && domainEnrichment.phone != null) {
      phone = domainEnrichment.phone;
    }
    if (email == null && domainEnrichment.email != null) {
      email = domainEnrichment.email;
    }
  }
} catch (e) {
  log.warn('places contact adopt failed (safe to ignore):', e.message);
}


// --- MAPS GUARDRAIL: website eTLD+1 moet exact matchen met gekozen domein ---
try {
  // Gebruik de juiste key uit jouw enrichFromDomain-resultaat
  const mapsUrl = domainEnrichment?.website_url || domainEnrichment?.website || null;

  if (mapsUrl && company_domain) {
    const mapsHost   = new URL(mapsUrl).hostname.toLowerCase();
    const mapsRoot   = psl.parse(mapsHost)?.domain || null;
    const chosenRoot = psl.parse(company_domain)?.domain || null;

    if (!mapsRoot || !chosenRoot || mapsRoot !== chosenRoot) {
      log.warn(`maps mismatch: ${mapsRoot || 'n/a'} ≠ ${chosenRoot || 'n/a'} → NIET overschrijven met Places-gegevens`);

      // ❌ Niets uit Places overnemen dat bedrijfsidentiteit kan vertekenen:
      // - naam/adres velden
      // - telefoon
      // - categorie(ën)
      if (domainEnrichment) {
        domainEnrichment.name                = null;
        domainEnrichment.domain_address      = null;
        domainEnrichment.domain_postal_code  = null;
        domainEnrichment.domain_city         = null;
        domainEnrichment.domain_country      = null;
        domainEnrichment.phone               = null;  // <-- NIEUW: telefoon niet overnemen
        domainEnrichment.category            = null;  // <-- NIEUW: categorie niet overnemen
        domainEnrichment.category_nl         = null;  // <-- NIEUW: NL-categorie niet overnemen
        // NB: overige velden (place_id, place_types, email, etc.) laten we ongemoeid voor nu.
      }

      // Informatieve reden; confidence blijft later nog door "signal floor" beschermd
      confidence_reason = (confidence_reason ? confidence_reason + ' + ' : '')
        + `Maps mismatch ${mapsRoot || '?'} ≠ ${chosenRoot || '?'}`;
    }
  }
} catch (e) {
  log.warn('Maps guardrail: website parse error:', e.message);
}

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
  if (phone == null && scraped.phone != null)                 phone = scraped.phone;
  if (email == null && scraped.email != null)                 email = scraped.email;
  if (linkedin_url == null && scraped.linkedin_url != null)   linkedin_url = scraped.linkedin_url;
  if (facebook_url == null && scraped.facebook_url != null)   facebook_url = scraped.facebook_url;
  if (instagram_url == null && scraped.instagram_url != null) instagram_url = scraped.instagram_url;
  if (twitter_url == null && scraped.twitter_url != null)     twitter_url = scraped.twitter_url;
  if (meta_description == null && scraped.meta_description != null) meta_description = scraped.meta_description;

  if (!enrichment_source) {
    enrichment_source = ENRICHMENT_SOURCES.SCRAPE;
  }
}



      if (domainEnrichment) {
  domain_lat = domainEnrichment.lat ?? null;
  domain_lon = domainEnrichment.lon ?? null;
  company_name = domainEnrichment.name ?? null;
  domain_address = domainEnrichment.domain_address ?? null;
  domain_postal_code = domainEnrichment.domain_postal_code ?? null;
  domain_city = domainEnrichment.domain_city ?? null;
  domain_country = domainEnrichment.domain_country ?? null;

  // 👉 Places v1 velden
  const nextCategoryEn  = domainEnrichment.category ?? null;       // bv "internet_marketing_service"
  const nextCategoryNl  = domainEnrichment.category_nl ?? null;    // bv "Internetmarketingbureau"
  place_id              = domainEnrichment.place_id ?? null;
  place_types           = Array.isArray(domainEnrichment.place_types) ? domainEnrichment.place_types : null;

  // Bepaal of we categorie mogen overschrijven (alleen als 'beter')
  const { data: curCatRow } = await supabaseAdmin
    .from('ipapi_cache')
    .select('category, category_nl')
    .eq('ip_address', ip_address)
    .maybeSingle();

  const shouldUpdateCat = isBetterCategory(
    curCatRow?.category ?? null,
    curCatRow?.category_nl ?? null,
    nextCategoryEn,
    nextCategoryNl
  );

  if (shouldUpdateCat) {
    category     = nextCategoryEn;
    category_nl  = nextCategoryNl;
  } else {
    // behoud eventueel al bestaande waarden in cache / voorkom downgrade
    category     = category ?? curCatRow?.category ?? null;
    category_nl  = category_nl ?? curCatRow?.category_nl ?? null;
  }

  enrichment_source = ENRICHMENT_SOURCES.GMAPS;

  // 👇 Confidence (zoals jij al had)
  const freqBoost = await calculateConfidenceByFrequency(ip_address, company_domain);
  if (freqBoost) {
    confidence = freqBoost.confidence;
    confidence_reason = freqBoost.reason;
  } else {
    confidence = domainEnrichment.confidence ?? 0.65;
    confidence_reason = domainEnrichment.confidence_reason ?? CONFIDENCE_REASONS.GMAPS;
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
}
    }


// ✅ Final confidence: signal floor (gecombineerde signalen) is leidend
const confParts = [];
if (typeof confidence === 'number' && !Number.isNaN(confidence)) confParts.push(confidence);
if (typeof cached?.confidence === 'number' && !Number.isNaN(cached.confidence)) confParts.push(cached.confidence);
if (typeof signals_base_confidence === 'number') confParts.push(signals_base_confidence);

let finalConfidence = confParts.length ? Math.max(...confParts) : null;

if (typeof finalConfidence === 'number') {
  if (typeof signals_base_confidence === 'number') {
    finalConfidence = Math.max(finalConfidence, signals_base_confidence);
  }
  confidence = clamp(Number(finalConfidence.toFixed(3)), 0, 0.99);
} else {
  confidence = null;
}



// ⛔️ Confidence-drempel check
const MIN_CONFIDENCE = 0.5;

// Alleen blokkeren als er GEEN domein is én confidence te laag is
// 👉 Als er wél een domein is, mag hij altijd door (ook bij lage confidence)
if ((!company_domain || company_domain.trim() === '') 
    && (typeof finalConfidence === 'number' && finalConfidence < MIN_CONFIDENCE)) {
log.info(`skip: no domain & conf ${finalConfidence} < ${MIN_CONFIDENCE}`);
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

// === STAP 7: Resultaat-normalisatie & guardrails ===

// 1) Clamp & opschonen confidence/reden
if (typeof finalConfidence === 'number') {
  confidence = clamp(finalConfidence, 0, 0.99); // boven 0.99 vermijden
} else {
  confidence = null;
}
confidence_reason = truncate(normText(confidence_reason), 400);

// 2) Domein is leidend: als er géén domein is, dan geen bedrijf/contact/social opslaan
if (!company_domain) {
  company_name = null;
  phone = null; email = null;
  linkedin_url = null; facebook_url = null; instagram_url = null; twitter_url = null;
  meta_description = null; category = null;
}

// 3) Company domain nog één keer strak normaliseren (lowercase en eTLD+1 via cleanAndValidateDomain)
if (company_domain) {
  const revalidated = cleanAndValidateDomain(
    company_domain,
    ENRICHMENT_SOURCES.FINAL_LIKELY,
    null, null, null, ip_address, confidence, confidence_reason
  );
  company_domain = revalidated || null;
  if (!company_domain) {
    // wanneer hij toch afvalt: alles resetten om mis-attributie te voorkomen
    company_name = null;
    phone = null; email = null;
    linkedin_url = null; facebook_url = null; instagram_url = null; twitter_url = null;
    meta_description = null; category = null;
  }
}

// 4) Tekstvelden normaliseren
company_name       = normName(company_name);
meta_description   = truncate(normText(meta_description), 500);
category           = truncate(normText(category), 60);
domain_address     = truncate(normText(domain_address), 200);
domain_city        = truncate(normText(domain_city), 80);
domain_country     = truncate(normText(domain_country), 80);
domain_postal_code = truncate(normText(domain_postal_code), 20);

// 5) Contactkanalen normaliseren
email  = normEmail(email);
phone  = normPhone(phone);
linkedin_url  = normUrl(linkedin_url);
facebook_url  = normUrl(facebook_url);
instagram_url = normUrl(instagram_url);
twitter_url   = normUrl(twitter_url);

// 6) Socials: alleen bewaren als ze (waarschijnlijk) bij het domein horen
if (company_domain) {
  for (const [k, v] of Object.entries({ facebook_url, instagram_url, twitter_url })) {
    if (v && !sameHostOrApex(v, company_domain)) {
      if (k === 'facebook_url')  facebook_url = null;
      if (k === 'instagram_url') instagram_url = null;
      if (k === 'twitter_url')   twitter_url = null;
    }
  }
}

// 7) Coördinaten sanity (geen IP-locatie hier gebruiken, alleen domeinlocatie)
if (!(validNum(domain_lat) && validNum(domain_lon))) {
  domain_lat = null; domain_lon = null;
}

// 8) rdns_hostname inkorten en ontdoen van rare tekens
reverseDnsDomain = truncate(normText(reverseDnsDomain), 255);

// 9) enrichment_source begrenzen tot bekende waarden
const KNOWN_SOURCES = new Set(Object.values(ENRICHMENT_SOURCES));
if (!KNOWN_SOURCES.has(enrichment_source)) {
  enrichment_source = ENRICHMENT_SOURCES.FINAL_LIKELY;
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
confidence: confidence, // clamped waarde uit stap 7
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
  category,
  place_id,                       // <-- NIEUW
  place_types,                    // <-- NIEUW (array in DB als jsonb)
  category_nl 
});

// 🔒 Manual lock? Sla helemaal niets op/over.
if (manualLock && cached) {
log.info('manual_enrich=true → cache skip');
  ipData = cached;
} else if (!cached) {
  const { error: insertErr } = await supabaseAdmin
    .from('ipapi_cache')
    .insert(cachePayload);
  if (insertErr) {
    console.error('❌ Insert error ipapi_cache:', insertErr);
  } else {
log.info('ipapi_cache insert ok');
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
    (!cached.category_nl && cachePayload.category_nl) || 
    (!cached.place_id && cachePayload.place_id) || 
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
log.info('ipapi_cache update ok');
      ipData = { ...cached, ...cachePayload };
    }
  } else {
log.dbg('cache not updated: existing >= new');
    ipData = cached;
  }
}

  }

  // Sla IP + domein op in fdns_lookup voor toekomstige enrichment
if (company_domain && ip_address) {
  await supabaseAdmin
    .from('fdns_lookup')
    .upsert({ ip: ip_address, domain: company_domain }, { onConflict: ['ip', 'domain'] });
}


// --- (Optioneel) SYNC naar 'leads' zodat de NL-categorie direct zichtbaar is ---
try {
  if (company_domain && org_id) {
    // Bouw alleen de velden die we daadwerkelijk hebben
    const leadsUpdate = pruneEmpty({
      place_id,                         // uit enrichFromDomain
      place_types,                      // array → jsonb in DB
      domain_address,
      domain_postal_code,
      domain_city,
      domain_country,
      domain_lat: (typeof domain_lat === 'number') ? domain_lat : undefined,
      domain_lon: (typeof domain_lon === 'number') ? domain_lon : undefined,
      // categorie-velden (we updaten alleen als we ze hebben)
      category:     category     ?? undefined,
      category_nl:  category_nl  ?? undefined
    });

    if (Object.keys(leadsUpdate).length > 0) {
      await supabaseAdmin
        .from('leads')
        .update(leadsUpdate)
        .eq('company_domain', company_domain)
        .eq('org_id', org_id);
    }
  }
} catch (e) {
  console.warn('⚠️ leads update met NL-categorie faalde:', e.message);
}

  // ⛔️ Belangrijk: geen insert in 'leads' vanuit /api/lead!
  // Deze endpoint verzorgt alleen enrichment + cache.
  // track.js schrijft de pageview en triggert KvK.

// ✅ Retro-update: vul recente leads (IP + site_id, laatste 30 min) met enrichment
try {
  const THIRTY_MIN_AGO = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: leadsToUpdate, error: leadFetchErr } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('ip_address', ip_address)
    .eq('site_id', site_id)
    .gte('created_at', THIRTY_MIN_AGO);

  if (leadFetchErr) {
    console.warn('⚠️ Retro-update: lead fetch faalde:', leadFetchErr.message);
  } else if (leadsToUpdate?.length) {
    const leadUpdatePayload = pruneEmpty({
      company_domain: company_domain || undefined,
      company_name: company_name || undefined,
      confidence: (typeof confidence === 'number') ? confidence : undefined,
      confidence_reason: confidence_reason || undefined,

      // Domain-locatie is leidend (géén IP-geo overschrijven)
      domain_address: domain_address || undefined,
      domain_postal_code: domain_postal_code || undefined,
      domain_city: domain_city || undefined,
      domain_country: domain_country || undefined,
      domain_lat: (typeof domain_lat === 'number') ? domain_lat : undefined,
      domain_lon: (typeof domain_lon === 'number') ? domain_lon : undefined,

      phone: phone || undefined,
      email: email || undefined,
      linkedin_url: linkedin_url || undefined,
      facebook_url: facebook_url || undefined,
      instagram_url: instagram_url || undefined,
      twitter_url: twitter_url || undefined,
      meta_description: meta_description || undefined,
      rdns_hostname: reverseDnsDomain || undefined,
      category: category || undefined,
      category_nl: category_nl || undefined,
      place_id: place_id || undefined,
      place_types: place_types || undefined
    });

    const { error: leadUpdErr } = await supabaseAdmin
      .from('leads')
      .update(leadUpdatePayload)
      .in('id', leadsToUpdate.map(r => r.id));

    if (leadUpdErr) {
      console.warn('⚠️ Retro-update: update faalde:', leadUpdErr.message);
    } else {
log.info(`retro-update leads: ${leadsToUpdate.length} updated for ${ip_address}/${site_id}`);
    }
  } else {
log.info('retro-update leads: none');
  }
} catch (e) {
  console.warn('⚠️ Retro-update: onverwachte fout:', e.message);
}


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