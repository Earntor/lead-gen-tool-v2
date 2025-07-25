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

export default async function handler(req, res) {
  // ✅ CORS preflight
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
    console.log("📦 Ontvangen body:", rawBody);
    body = JSON.parse(rawBody);
    console.log("✅ Parsed body object:", body);
    console.log("🧪 durationSeconds ontvangen:", body.durationSeconds);
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

  if (!projectId || !pageUrl) {
    return res.status(400).json({ error: 'projectId and pageUrl are required' });
  }

  const isValidation = validationTest === true;

  try {
    const url = new URL(pageUrl);
    if (url.hostname.endsWith('vercel.app') && !isValidation) {
      return res.status(200).json({ success: true, message: 'Dashboard visit ignored' });
    }
  } catch (e) {
    return res.status(200).json({ success: true, message: 'Invalid pageUrl ignored' });
  }

  // ✅ IP-adres ophalen
  const ipAddress =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket?.remoteAddress ||
    null;

  if (!ipAddress) {
    console.warn("❌ Geen IP-adres beschikbaar — request genegeerd");
    return res.status(400).json({ error: 'Missing IP address' });
  }

  let confidenceScore = null;
  let confidenceReason = null;

  const { data: ipCache, error: ipErr } = await supabase
    .from('ipapi_cache')
    .select('confidence, confidence_reason')
    .eq('ip_address', ipAddress)
    .maybeSingle();

  if (ipCache) {
    confidenceScore = ipCache.confidence ?? null;
    confidenceReason = ipCache.confidence_reason ?? null;
    console.log("🧠 Confidence gevonden:", confidenceScore, confidenceReason);
  } else {
    console.log("⚠️ Geen confidence gevonden voor IP:", ipAddress);
    // 🚀 Fallback naar enrichment als IP onbekend
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

  const { error } = await supabase
    .from('leads')
    .insert({
      user_id: projectId,
      site_id: siteId || null,
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
    console.error("❌ Supabase error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  await supabase
    .from('profiles')
    .update({ last_tracking_ping: new Date().toISOString() })
    .eq('id', projectId);

  return res.status(200).json({ success: true });
}
