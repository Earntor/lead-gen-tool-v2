import { createClient } from '@supabase/supabase-js';
import getRawBody from 'raw-body';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// JWT ingest auth (noodrem mogelijk via env)
// In productie altijd token vereisen, in development mag het leeg zijn
const REQUIRE_TOKEN = process.env.NODE_ENV === 'production';
const INGEST_JWT_SECRET = process.env.INGEST_JWT_SECRET;

export const config = { api: { bodyParser: false } };

/* ----------------------- Helpers ----------------------- */

// Geldige domeinen (voorkom vercel.app en localhost)
function isValidDomain(domain) {
  const invalids = ['localhost', '127.0.0.1', '::1', '', null];
  return (
    typeof domain === 'string' &&
    domain.length > 3 &&
    !invalids.includes(domain.toLowerCase()) &&
    !domain.endsWith('vercel.app')
  );
}

// Interne pagina’s (GEEN '/' -> homepage niet uitfilteren)
function isInternalPage(pageUrl) {
  try {
    const url = new URL(pageUrl, 'https://fallback.nl');
    const internalPaths = ['/dashboard', '/account', '/login']; // GEEN '/'
    return internalPaths.some(
      (p) => url.pathname === p || url.pathname.startsWith(p + '/')
    );
  } catch {
    return true; // onparseerbaar -> overslaan
  }
}

// Duur normaliseren
function normalizeDuration(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n < 0) return 0;
  const rounded = Math.round(n);
  return Math.min(1800, rounded);
}

// URL normaliseren (zonder query/hash, zonder trailing slash)
function canonicalizeUrl(input) {
  try {
    const u = new URL(input, 'https://fallback.nl');
    let p = u.pathname || '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    // ⚠️ voorkom fallback-origin in DB
    if (u.origin === 'https://fallback.nl') return p || '/';
    return `${u.origin}${p}`;
  } catch {
    return input;
  }
}


// ipapi_cache -> leads kolommen
function mapCacheToLead(ipCache) {
  if (!ipCache) return {};
  const toNum = (v) =>
    v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

   return {
    company_name: ipCache.company_name ?? null,
    company_domain: ipCache.company_domain ?? null,
    ip_street: ipCache.ip_street ?? null,
    ip_postal_code: ipCache.ip_postal_code ?? null,
    ip_city: ipCache.ip_city ?? null,
    ip_country: ipCache.ip_country ?? null,
    domain_address: ipCache.domain_address ?? null,
    domain_postal_code: ipCache.domain_postal_code ?? null,
    domain_city: ipCache.domain_city ?? null,
    domain_country: ipCache.domain_country ?? null,
    domain_lat: ipCache.domain_lat ?? null,
    domain_lon: ipCache.domain_lon ?? null,
    confidence: toNum(ipCache.confidence),
    confidence_reason: ipCache.confidence_reason ?? null,
    auto_confidence: ipCache.auto_confidence ?? null,
    auto_confidence_reason: ipCache.auto_confidence_reason ?? null,
    selected_random_match: ipCache.selected_random_match ?? null,
    phone: ipCache.phone ?? null,
    email: ipCache.email ?? null,
    linkedin_url: ipCache.linkedin_url ?? null,
    facebook_url: ipCache.facebook_url ?? null,
    instagram_url: ipCache.instagram_url ?? null,
    twitter_url: ipCache.twitter_url ?? null,
    meta_description: ipCache.meta_description ?? null,
    rdns_hostname: ipCache.rdns_hostname ?? null,
    category: ipCache.category ?? null,
    location: ipCache.location ?? null,
    kvk_number: ipCache.kvk_number ?? null,
    kvk_domain: ipCache.kvk_domain ?? null,
    kvk_street: ipCache.kvk_street ?? null,
    kvk_postal_code: ipCache.kvk_postal_code ?? null,
    kvk_city: ipCache.kvk_city ?? null,
    kvk_country: ipCache.kvk_country ?? null
  };
}

// IP helpers (IPv4/IPv6 + proxies)
function isPrivate(ip){
  if (!ip) return true;
  ip = ip.replace(/^::ffff:/,'');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (/^10\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^(fc|fd)/i.test(ip)) return true; // ULA
  return false;
}
function firstPublicIp(xff, remoteAddr){
  const list = []
    .concat((xff || '').split(',').map(s=>s.trim()).filter(Boolean))
    .concat(remoteAddr || []);
  for (const cand of list){
    const ip = cand.replace(/^::ffff:/,'');
    if (!isPrivate(ip)) return ip;
  }
  return (remoteAddr || '').replace(/^::ffff:/,'') || null;
}

async function resolveOrgIdForSite(supabase, siteId) {
  if (!siteId) return null;
  try {
    // 1) exacte hostmatch op sites.site_id
    const { data: byHost } = await supabase
      .from('sites')
      .select('org_id')
      .eq('site_id', siteId)
      .maybeSingle();
    if (byHost?.org_id) return byHost.org_id;

    // 2) fallback: basisdomein match op sites.domain_name
    // mail.schipholtaxioldenzaal.nl -> schipholtaxioldenzaal.nl
    const base = siteId.replace(/^[^.]+\./, '');
    if (base && base !== siteId) {
      const { data: byBase } = await supabase
        .from('sites')
        .select('org_id')
        .eq('domain_name', base)
        .maybeSingle();
      if (byBase?.org_id) return byBase.org_id;
    }
  } catch {
    // stil falen is ok; orgId blijft null
  }
  return null;
}


/* ----------------------- Handler ----------------------- */

export default async function handler(req, res) {
  // CORS (voeg Authorization toe)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Id');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Lees RAW body (prima, ook zonder HMAC)
  let rawBody = '';
  try {
    rawBody = await getRawBody(req, {
      encoding: true,
      length: req.headers['content-length'],
      limit: '1mb'
    });
  } catch (err) {
    console.error('❌ raw-body error:', err.message);
    return res.status(400).json({ error: 'Invalid body' });
  }

  // Bearer-token (JWT) i.p.v. HMAC
  let tokenPayload = null;
  if (REQUIRE_TOKEN) {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing bearer token' });
    }
    const token = auth.slice('Bearer '.length);
    try {
      tokenPayload = jwt.verify(token, INGEST_JWT_SECRET, { algorithms: ['HS256'] });
      if (!tokenPayload?.site_id || !tokenPayload?.org_id) {
  return res.status(401).json({ error: 'invalid token payload' });
}

    } catch {
      return res.status(401).json({ error: 'bad token' });
    }
  }

  // JSON parsen
  let body = {};
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error('❌ JSON parse error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // (optioneel) header-site (alleen voor logging/safety)
  const siteIdHdr = req.headers['x-site-id'];

  const {
  projectId,                // mag bestaan, maar NIET gebruiken als org_id
  siteId: siteIdFromBody,
  pageUrl,
  anonId,
  sessionId,
  durationSeconds,
  utmSource,
  utmMedium,
  utmCampaign,
  referrer,
  validationTest,
  eventType // "load" of "end"
} = body;

const siteId = siteIdFromBody || tokenPayload?.site_id || siteIdHdr || null;
const canonicalPageUrl = canonicalizeUrl(pageUrl);
const isValidation = validationTest === true;

// Alleen pageUrl + siteId zijn verplicht
if (!pageUrl || !siteId) {
  return res.status(400).json({ error: 'siteId and pageUrl are required' });
}

// Bepaal org_id: eerst uit token (als aanwezig), anders lookup via sites.*
let orgId = tokenPayload?.org_id || null;
if (!orgId) {
  orgId = await resolveOrgIdForSite(supabase, siteId);
}

if (!orgId) {
  return res.status(401).json({
    error: 'org not resolved for siteId (link site to org first)'
  });
}


  if (!isValidDomain(siteId)) {
    return res.status(200).json({ success: false, message: 'Invalid siteId - ignored' });
  }
  if (!isValidation && isInternalPage(pageUrl)) {
    return res.status(200).json({ success: true, skipped: true, reason: 'internal page' });
  }

  // IP bepalen
  const ipAddress = firstPublicIp(
    req.headers['x-forwarded-for'],
    req.socket?.remoteAddress || req.connection?.remoteAddress
  );
  if (!ipAddress) {
    return res.status(400).json({ error: 'Missing IP address' });
  }

  // sites bijhouden (zoals je had)
  try {
    const { data: existingSite, error: siteErr } = await supabase
      .from('sites')
      .select('id')
      .eq('site_id', siteId)
      .maybeSingle();

   if (!existingSite && !siteErr && orgId) {
  const cleanedDomain = String(siteId).replace(/^www\./, '');
  await supabase.from('sites').insert({
    site_id: siteId,
    org_id: orgId,
    domain_name: cleanedDomain
  });
}

  } catch (e) {
    console.warn('⚠️ sites insert check faalde:', e.message);
  }

  // Enrichment uit cache
  let ipCache = null;
  try {
    const { data } = await supabase
      .from('ipapi_cache')
      .select('*')
      .eq('ip_address', ipAddress)
      .maybeSingle();
    ipCache = data || null;
  } catch (e) {
    console.warn('⚠️ ipapi_cache fetch faalde:', e.message);
  }
  const enrichment = mapCacheToLead(ipCache);
if (!ipCache) {
  console.log(`ℹ️ Geen enrichment gevonden voor IP ${ipAddress} (waarschijnlijk ISP/no-domain)`);
}


  const confidenceScore =
    enrichment.confidence === undefined ? null : enrichment.confidence;
  const confidenceReason =
    enrichment.confidence_reason === undefined ? null : enrichment.confidence_reason;

  // ---- Queue insert i.p.v. fire-and-forget enrich ----
  try {
  const needsEnrichment =
    (!!ipAddress && !ipCache) ||                                  // 1) nieuw IP
    (!!ipAddress && !!ipCache && !ipCache.company_domain) ||      // 2) cache bestaat maar nog geen domein
    (ipCache?.company_domain && (                                 // 3) domein bekend maar profiel incompleet
      !ipCache.domain_address ||
      !ipCache.domain_city ||
      !ipCache.domain_country ||
      ipCache.confidence == null ||
      !ipCache.confidence_reason ||
      !ipCache.meta_description ||
      !ipCache.phone ||
      !ipCache.email ||
      !ipCache.domain_lat ||
      !ipCache.domain_lon ||
      !ipCache.category ||
      !ipCache.rdns_hostname ||
      !ipCache.linkedin_url ||
      !ipCache.facebook_url ||
      !ipCache.instagram_url ||
      !ipCache.twitter_url
    ));

const shouldQueueThisEvent = (eventType || 'load') === 'load';

if (shouldQueueThisEvent && needsEnrichment) {
  const { error: qErr } = await supabase
    .from('enrichment_queue')
    .insert({
      ip_address: ipAddress,
      org_id:     orgId,
      site_id:    siteId,
      page_url:   canonicalPageUrl,
      status:     'pending',
      attempts:   0,
      payload: {
        anonId:           anonId || null,
        referrer:         referrer || null,
        utmSource:        utmSource || null,
        utmMedium:        utmMedium || null,
        utmCampaign:      utmCampaign || null,
        durationSeconds:  normalizeDuration(durationSeconds)
      }
    });

  // ✅ Fix C: duplicate (23505) negeren, andere fouten wél loggen
  if (qErr) {
    const isDuplicate =
      qErr.code === '23505' ||
      /duplicate key value/i.test(qErr.message || '') ||
      /unique constraint/i.test(qErr.message || '');
    if (!isDuplicate) {
      console.warn('⚠️ queue insert faalde:', qErr.message, qErr.code, qErr.details);
    }
  }
}


} catch (e) {
  console.warn('⚠️ queue insert exception:', e.message);
}

  // Health ping / script validatie
const nowIso = new Date().toISOString();
if (isValidation) {
  await supabase
    .from('organizations')
    .update({ last_tracking_ping: nowIso })
    .eq('id', orgId);   // ✅ juiste key: organisaties primary key
  return res.status(200).json({ success: true, validation: true });
}



  // -------- Dedup (zoals je had) --------
  let recent = null;
  let recentErr = null;

  if (sessionId) {
    ({ data: recent, error: recentErr } = await supabase
      .from('leads')
      .select('id, created_at, duration_seconds, company_domain, company_name, domain_lat')
      .eq('session_id', sessionId)
      .eq('page_url', canonicalPageUrl)
      .order('created_at', { ascending: false })
      .limit(1));
  } else if (anonId) {
    ({ data: recent, error: recentErr } = await supabase
      .from('leads')
      .select('id, created_at, duration_seconds, company_domain, company_name, domain_lat')
      .eq('anon_id', anonId)
      .eq('page_url', canonicalPageUrl)
      .order('created_at', { ascending: false })
      .limit(1));
  } else {
    const tenSecAgo = new Date(Date.now() - 10_000).toISOString();
    ({ data: recent, error: recentErr } = await supabase
      .from('leads')
      .select('id, created_at, duration_seconds, company_domain, company_name, domain_lat')
      .eq('ip_address', ipAddress)
      .eq('page_url', canonicalPageUrl)
      .gte('created_at', tenSecAgo)
      .order('created_at', { ascending: false })
      .limit(1));
  }

  const dur = normalizeDuration(durationSeconds);

  if (!recentErr && recent && recent.length > 0) {
    const last = recent[0];
    const lastCreated = new Date(last.created_at).getTime();
    const ageMs = Date.now() - lastCreated;

    if (eventType === 'load' && ageMs < 10_000) {
      await supabase
  .from('organizations')
  .update({ last_tracking_ping: nowIso })
  .eq('id', orgId);
      return res
        .status(200)
        .json({ success: true, deduped: true, reason: 'load duplicate' });
    }

    if (eventType === 'end') {
      const updates = {};
      const prevDur = Number(last.duration_seconds ?? 0);
      if (dur > prevDur) updates.duration_seconds = dur;

      const hasEnrichmentAlready =
        !!last.company_domain || !!last.company_name || !!last.domain_lat;
      if (!hasEnrichmentAlready && ipCache) {
        Object.assign(updates, enrichment);
      }

      if (Object.keys(updates).length > 0) {
        const { error: updErr } = await supabase
          .from('leads')
          .update(updates)
          .eq('id', last.id);
        if (updErr) console.error('❌ Update error:', updErr.message);
      }

      await supabase
  .from('organizations')
  .update({ last_tracking_ping: nowIso })
  .eq('id', orgId);
      return res.status(200).json({ success: true, updated: true });
    }
    // anders: laat nieuwe insert toe
  }

  if (eventType === 'end') {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    if (sessionId) {
      const { data: fb, error: fbErr } = await supabase
        .from('leads')
        .select('id, duration_seconds')
        .eq('session_id', sessionId)
        .eq('page_url', canonicalPageUrl)
        .gte('created_at', threeHoursAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!fbErr && fb && fb.length > 0) {
        const prevDur = Number(fb[0].duration_seconds ?? 0);
        if (dur > prevDur) {
          await supabase.from('leads').update({ duration_seconds: dur }).eq('id', fb[0].id);
        }
        await supabase.from('organizations').update({ last_tracking_ping: nowIso }).eq('id', orgId);
        return res.status(200).json({ success: true, updated: true, fallbackMatched: true });
      }
    }
  }

  // Nieuwe pageview
  const insertPayload = {
  org_id: orgId,
  site_id: siteId,
  page_url: canonicalPageUrl,
  ip_address: ipAddress,
  source: 'tracker',
  anon_id: anonId || null,
  session_id: sessionId || null,
  duration_seconds: dur,
  utm_source: utmSource || null,
  utm_medium: utmMedium || null,
  utm_campaign: utmCampaign || null,
  referrer: referrer || null,
  timestamp: nowIso,
  ...mapCacheToLead(ipCache) // ✅ dit vult ALLE enrichment velden uit je schema
};


  const { data: inserted, error: insertErr } = await supabase
    .from('leads')
    .insert(insertPayload)
    .select('id, company_name');

 if (insertErr) {
  console.error('❌ Supabase error bij leads-insert:', insertErr.message, insertErr.details || '');
  return res.status(500).json({ error: insertErr.message || 'insert failed' });
}



  // KvK-lookup (ongewijzigd)
  try {
    const lead = inserted?.[0];
    const companyNameForKvk = insertPayload.company_name || lead?.company_name || null;
    if (lead?.id && companyNameForKvk) {
      fetch(`${process.env.NEXT_PUBLIC_TRACKING_DOMAIN || 'http://localhost:3000'}/api/kvk-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, company_name: companyNameForKvk })
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('⚠️ KvK trigger faalde:', e.message);
  }

  await supabase
  .from('organizations')
  .update({ last_tracking_ping: nowIso })
  .eq('id', orgId);

  // 🔔 DIRECTE ENRICHMENT-KICK (niet wachten op Plan B)
{
  const BASE_URL =
    process.env.NEXT_PUBLIC_TRACKING_DOMAIN
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  fetch(`${BASE_URL}/api/lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ip_address:        ipAddress,
      org_id:            orgId,
      page_url:          canonicalPageUrl,
      anon_id:           anonId || null,
      referrer:          referrer || null,
      utm_source:        utmSource || null,
      utm_medium:        utmMedium || null,
      utm_campaign:      utmCampaign || null,
      duration_seconds:  normalizeDuration(durationSeconds),
      site_id:           siteId
    })
  }).catch((e) => {
    console.warn('⚠️ directe enrichment-kick (fire-and-forget) faalde:', e?.message || e);
  });
}



// Plan B: verwerk 1 pending enrichment job als fallback
try {
  const { data: job } = await supabase
    .from('enrichment_queue')
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - 60 * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (job) {
    await supabase
      .from('enrichment_queue')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'pending');

    const p = job.payload && typeof job.payload === 'object' ? job.payload : {};
    const body = {
      ip_address: job.ip_address,
      org_id: job.org_id,
      page_url: job.page_url,
      anon_id: p.anonId ?? null,
      referrer: p.referrer ?? null,
      utm_source: p.utmSource ?? null,
      utm_medium: p.utmMedium ?? null,
      utm_campaign: p.utmCampaign ?? null,
      duration_seconds: p.durationSeconds ?? 0,
      site_id: job.site_id
    };

    const BASE_URL =
      process.env.NEXT_PUBLIC_TRACKING_DOMAIN
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    const resp = await fetch(`${BASE_URL}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (resp.ok) {
      await supabase
        .from('enrichment_queue')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', job.id);
    } else {
      await supabase
        .from('enrichment_queue')
        .update({
          status: 'error',
          attempts: (job.attempts || 0) + 1,
          error_text: `Fallback lead ${resp.status}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
    }
  }
} catch (e) {
  console.warn('⚠️ Fallback enrichment faalde:', e.message);
}


  return res.status(200).json({ success: true });
}
