import { createClient } from '@supabase/supabase-js';
import getRawBody from 'raw-body';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: false,
  },
};

function isValidDomain(domain) {
  const invalids = ['localhost', '127.0.0.1', '::1', '', null];
  return (
    typeof domain === 'string' &&
    domain.length > 3 &&
    !invalids.includes(domain.toLowerCase()) &&
    !domain.endsWith('vercel.app')
  );
}

function isInternalPage(pageUrl) {
  try {
    const url = new URL(pageUrl, "https://fallback.nl"); // werkt ook bij relatieve URLs
    const internalPaths = ['/dashboard', '/account', '/login', '/']; // voeg toe wat nodig is
    return internalPaths.some((path) => url.pathname === path || url.pathname.startsWith(path + '/'));
  } catch (e) {
    console.warn("⚠️ Ongeldige page_url ontvangen:", pageUrl);
    return true; // als hij niet geparsed kan worden, liever overslaan
  }
}

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

  let body = {};
  try {
    const rawBody = await getRawBody(req, {
      encoding: true,
      length: req.headers['content-length'],
      limit: '1mb',
    });
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error("❌ JSON parse error:", err.message);
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
  } = body;

  const isValidation = validationTest === true;

  if (!projectId || !pageUrl || !siteId) {
    return res.status(400).json({ error: 'projectId, siteId and pageUrl are required' });
  }

  if (!isValidDomain(siteId)) {
    console.warn(`❌ Ongeldig siteId ontvangen: ${siteId}`);
    return res.status(200).json({ success: false, message: 'Invalid siteId - ignored' });
  }

  if (isInternalPage(pageUrl) && !isValidation) {
    console.log("⛔️ Interne pagina bezocht, tracking overgeslagen:", pageUrl);
    return res.status(200).json({ success: true, skipped: true });
  }

  const ipAddress =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket?.remoteAddress ||
    null;

  if (!ipAddress) {
    console.warn("❌ Geen IP-adres beschikbaar — request genegeerd");
    return res.status(400).json({ error: 'Missing IP address' });
  }

  console.log("📡 Bezoek ontvangen van", siteId, "met IP", ipAddress);

  const { data: existingSite, error: siteErr } = await supabase
    .from('sites')
    .select('id')
    .eq('site_id', siteId)
    .maybeSingle();

  if (!existingSite && !siteErr) {
    console.log("🆕 Nieuwe site toegevoegd:", siteId);
    const cleanedDomain = siteId.replace(/^www\./, '');
    await supabase.from('sites').insert({
      site_id: siteId,
      user_id: projectId,
      domain_name: cleanedDomain,
    });
  } else if (existingSite) {
    console.log("✅ Bestaande site gevonden:", siteId);
  } else if (siteErr) {
    console.error("❌ Fout bij ophalen van sites:", siteErr.message);
  }

  let confidenceScore = null;
  let confidenceReason = null;

  const { data: ipCache } = await supabase
    .from('ipapi_cache')
    .select('confidence, confidence_reason')
    .eq('ip_address', ipAddress)
    .maybeSingle();

  if (ipCache) {
    confidenceScore = ipCache.confidence ?? null;
    confidenceReason = ipCache.confidence_reason ?? null;
  } else {
    try {
      console.log("📡 Start enrichment voor onbekend IP...");
      await fetch(`${process.env.NEXT_PUBLIC_TRACKING_DOMAIN || 'http://localhost:3000'}/api/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip_address: ipAddress,
          user_id: projectId,
          page_url: pageUrl,
          anon_id: anonId || null,
          referrer: referrer || null,
          utm_source: utmSource || null,
          utm_medium: utmMedium || null,
          utm_campaign: utmCampaign || null,
          duration_seconds: durationSeconds || null,
        }),
      });
    } catch (e) {
      console.error("❌ Fout bij enrichment-call:", e.message);
    }
  }

  if (isValidation) {
    await supabase
      .from('profiles')
      .update({ last_tracking_ping: new Date().toISOString() })
      .eq('id', projectId);

    return res.status(200).json({ success: true, validation: true });
  }

  const { error } = await supabase.from('leads').insert({
    user_id: projectId,
    site_id: siteId,
    page_url: pageUrl,
    ip_address: ipAddress,
    source: 'tracker',
    anon_id: anonId || null,
    session_id: sessionId || null,
    duration_seconds: durationSeconds || null,
    confidence: confidenceScore,
    confidence_reason: confidenceReason,
    utm_source: utmSource || null,
    utm_medium: utmMedium || null,
    utm_campaign: utmCampaign || null,
    referrer: referrer || null,
    timestamp: new Date().toISOString(),
  });

  if (error) {
    console.error("❌ Supabase error bij leads-insert:", error.message);
    return res.status(500).json({ error: error.message });
  }

  await supabase
    .from('profiles')
    .update({ last_tracking_ping: new Date().toISOString() })
    .eq('id', projectId);

  return res.status(200).json({ success: true });
}
