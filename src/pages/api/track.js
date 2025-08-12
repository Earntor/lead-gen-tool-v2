import { createClient } from '@supabase/supabase-js';
import getRawBody from 'raw-body';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: false }
};

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

// Interne pagina’s (let op: GEEN '/' -> homepage wordt niet uitgefilterd)
function isInternalPage(pageUrl) {
  try {
    const url = new URL(pageUrl, 'https://fallback.nl');
    const internalPaths = ['/dashboard', '/account', '/login']; // GEEN '/'
    return internalPaths.some(
      (p) => url.pathname === p || url.pathname.startsWith(p + '/')
    );
  } catch {
    // Onparseerbaar -> overslaan om rommel te voorkomen
    return true;
  }
}

// Duur normaliseren (altijd een nummer tussen 0 en 1800s)
function normalizeDuration(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n < 0) return 0;
  const rounded = Math.round(n);
  return Math.min(1800, rounded);
}

// URL normaliseren: zelfde pagina → zelfde key (zonder query/hash, zonder trailing slash)
function canonicalizeUrl(input) {
  try {
    const u = new URL(input, 'https://fallback.nl');
    let p = u.pathname || '/';
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
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
    location: ipCache.location ?? null,
    ip_street: ipCache.ip_street ?? null,
    ip_postal_code: ipCache.ip_postal_code ?? null,
    ip_city: ipCache.ip_city ?? null,
    ip_country: ipCache.ip_country ?? null,

    domain_address: ipCache.domain_address ?? null,
    domain_postal_code: ipCache.domain_postal_code ?? null,
    domain_city: ipCache.domain_city ?? null,
    domain_country: ipCache.domain_country ?? null,

    confidence_reason: ipCache.confidence_reason ?? null,
    confidence: toNum(ipCache.confidence),

    phone: ipCache.phone ?? null,
    email: ipCache.email ?? null,
    linkedin_url: ipCache.linkedin_url ?? null,
    facebook_url: ipCache.facebook_url ?? null,
    instagram_url: ipCache.instagram_url ?? null,
    twitter_url: ipCache.twitter_url ?? null,
    meta_description: ipCache.meta_description ?? null,

    domain_lat: ipCache.domain_lat ?? null,
    domain_lon: ipCache.domain_lon ?? null,

    rdns_hostname: ipCache.rdns_hostname ?? null,
    category: ipCache.category ?? null
  };
}

/* ----------------------- Handler ----------------------- */

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Body lezen
  let body = {};
  try {
    const rawBody = await getRawBody(req, {
      encoding: true,
      length: req.headers['content-length'],
      limit: '1mb'
    });
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error('❌ JSON parse error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const {
    projectId,
    siteId,
    pageUrl,
    anonId,
    sessionId,
    durationSeconds,
    utmSource,
    utmMedium,
    utmCampaign,
    referrer,
    validationTest,
    eventType // "load" of "end" (kan ontbreken bij oudere scripts)
  } = body;

  const canonicalPageUrl = canonicalizeUrl(pageUrl);
  const isValidation = validationTest === true;

  // Basis validaties
  if (!projectId || !pageUrl || !siteId) {
    return res
      .status(400)
      .json({ error: 'projectId, siteId and pageUrl are required' });
  }
  if (!isValidDomain(siteId)) {
    return res
      .status(200)
      .json({ success: false, message: 'Invalid siteId - ignored' });
  }
  if (isInternalPage(pageUrl) && !isValidation) {
    return res
      .status(200)
      .json({ success: true, skipped: true, reason: 'internal page' });
  }

  // IP bepalen
  const ipAddress =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null;

  if (!ipAddress) {
    return res.status(400).json({ error: 'Missing IP address' });
  }

  // sites bijhouden (optioneel)
  try {
    const { data: existingSite, error: siteErr } = await supabase
      .from('sites')
      .select('id')
      .eq('site_id', siteId)
      .maybeSingle();

    if (!existingSite && !siteErr) {
      const cleanedDomain = siteId.replace(/^www\./, '');
      await supabase.from('sites').insert({
        site_id: siteId,
        user_id: projectId,
        domain_name: cleanedDomain
      });
    }
  } catch (e) {
    console.warn('⚠️ sites insert check faalde:', e.message);
  }

  // Enrichment uit cache ophalen (volledige rij)
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
  const confidenceScore =
    enrichment.confidence === undefined ? null : enrichment.confidence;
  const confidenceReason =
    enrichment.confidence_reason === undefined
      ? null
      : enrichment.confidence_reason;

  // ---- Fire-and-forget enrichment trigger (alleen als cache leeg of incompleet)
  try {
    const needsEnrichment =
      !ipCache ||
      ipCache.company_name === 'Testbedrijf' ||
      (ipCache.company_domain && (
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

    if (needsEnrichment) {
      const base = process.env.NEXT_PUBLIC_TRACKING_DOMAIN || 'http://localhost:3000';
      // Niet wachten — laat de tracker snel terugkeren
      fetch(`${base}/api/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip_address: ipAddress,
          user_id: projectId,
          page_url: canonicalPageUrl, // canonisch meest nuttig
          anon_id: anonId || null,
          referrer: referrer || null,
          utm_source: utmSource || null,
          utm_medium: utmMedium || null,
          utm_campaign: utmCampaign || null,
          duration_seconds: normalizeDuration(durationSeconds),
          site_id: siteId
        })
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('⚠️ enrichment trigger faalde:', e.message);
  }

  // Health ping
  if (isValidation) {
    await supabase
      .from('profiles')
      .update({ last_tracking_ping: new Date().toISOString() })
      .eq('id', projectId);
    return res.status(200).json({ success: true, validation: true });
  }

  // -------- Dedup-strategie (met NULL-fallback) --------
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
    // Laatste redmiddel: dedup op IP + page_url binnen 10s window
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

  const nowIso = new Date().toISOString();
  const dur = normalizeDuration(durationSeconds);

  // Als er al een rij bestaat
  if (!recentErr && recent && recent.length > 0) {
    const last = recent[0];
    const lastCreated = new Date(last.created_at).getTime();
    const ageMs = Date.now() - lastCreated;

    // 1) "load" binnen 10s -> zie als dubbel en sla over
    if (eventType === 'load' && ageMs < 10_000) {
      await supabase
        .from('profiles')
        .update({ last_tracking_ping: nowIso })
        .eq('id', projectId);
      return res
        .status(200)
        .json({ success: true, deduped: true, reason: 'load duplicate' });
    }

    // 2) "end" -> update duur (indien groter) en vul enrichment aan als het nu bekend is
    if (eventType === 'end') {
      const updates = {};
      const prevDur = Number(last.duration_seconds ?? 0);
      if (dur > prevDur) updates.duration_seconds = dur;

      // Vul enrichment bij als we eerder nog niets hadden (of er nu meer is)
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
        .from('profiles')
        .update({ last_tracking_ping: nowIso })
        .eq('id', projectId);
      return res.status(200).json({ success: true, updated: true });
    }
    // Valt niet onder bovenstaande -> laat nieuwe insert toe
  }

  // 🔎 Fallback: "end" maar geen recent record gevonden → probeer alsnog op sessie+canonieke URL
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
        await supabase.from('profiles').update({ last_tracking_ping: nowIso }).eq('id', projectId);
        return res.status(200).json({ success: true, updated: true, fallbackMatched: true });
      }
    }
  }

  // Nieuwe pageview inserten (meestal bij "load")
  const insertPayload = {
    user_id: projectId,
    site_id: siteId,
    page_url: canonicalPageUrl,
    ip_address: ipAddress,
    source: 'tracker',
    anon_id: anonId || null,
    session_id: sessionId || null,
    duration_seconds: dur,
    confidence: confidenceScore,
    confidence_reason: confidenceReason,
    utm_source: utmSource || null,
    utm_medium: utmMedium || null,
    utm_campaign: utmCampaign || null,
    referrer: referrer || null,
    timestamp: nowIso,
    ...enrichment // alle verrijkte velden uit cache (als beschikbaar)
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('leads')
    .insert(insertPayload)
    .select('id, company_name');

  if (insertErr) {
    console.error('❌ Supabase error bij leads-insert:', insertErr.message);
    return res.status(500).json({ error: insertErr.message });
  }

  // 🔔 KvK-lookup (alleen als we een naam hebben)
  try {
    const lead = inserted?.[0];
    const companyNameForKvk = insertPayload.company_name || lead?.company_name || null;
    if (lead?.id && companyNameForKvk) {
      fetch(`${process.env.NEXT_PUBLIC_TRACKING_DOMAIN || 'http://localhost:3000'}/api/kvk-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          company_name: companyNameForKvk
        })
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('⚠️ KvK trigger faalde:', e.message);
  }

  await supabase
    .from('profiles')
    .update({ last_tracking_ping: nowIso })
    .eq('id', projectId);

  return res.status(200).json({ success: true });
}
