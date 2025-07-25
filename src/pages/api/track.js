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
    const rawBody = await getRawBody(req);
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch (err) {
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

  const ipAddress =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket?.remoteAddress ||
    null;

  if (isValidation) {
    await supabase
      .from('profiles')
      .update({ last_tracking_ping: new Date().toISOString() })
      .eq('id', projectId);

    return res.status(200).json({ success: true, validation: true });
  }

  const { error } = await supabase
    .from('leads')
    .upsert({
      user_id: projectId,
      site_id: siteId || null,
      page_url: pageUrl,
      ip_address: ipAddress,
      source: 'tracker',
      anon_id: anonId || null,
      session_id: sessionId || null,
      duration_seconds: durationSeconds || null,
      utm_source: utmSource || null,
      utm_medium: utmMedium || null,
      utm_campaign: utmCampaign || null,
      referrer: referrer || null,
      timestamp: new Date().toISOString(),
    }, {
      onConflict: 'session_id',
      ignoreDuplicates: false,
    });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  await supabase
    .from('profiles')
    .update({ last_tracking_ping: new Date().toISOString() })
    .eq('id', projectId);

  return res.status(200).json({ success: true });
}
