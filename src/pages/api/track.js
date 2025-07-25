// pages/api/track.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

  const {
    projectId,        // verplicht
    siteId,           // optioneel
    pageUrl,
    anonId,
    durationSeconds,
    utmSource,
    utmMedium,
    utmCampaign,
    referrer,
    validationTest    // 👈 wordt true meegegeven bij validatie
  } = req.body;

  if (!projectId || !pageUrl) {
    return res.status(400).json({ error: 'projectId and pageUrl are required' });
  }

  // Verifieer geldige URL
  try {
    const url = new URL(pageUrl);
    if (url.hostname.endsWith('vercel.app')) {
      console.log('❌ Dashboard bezoek genegeerd in backend:', pageUrl);
      return res.status(200).json({ success: true, message: 'Dashboard visit ignored' });
    }
  } catch (e) {
    console.warn('⚠️ Ongeldige pageUrl ontvangen:', pageUrl);
    return res.status(200).json({ success: true, message: 'Invalid pageUrl ignored' });
  }

  // IP ophalen
  const ipAddress =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket?.remoteAddress ||
    null;

  if (!ipAddress) {
    console.warn('⚠️ Geen IP-adres gevonden');
  }

  // ✅ Alleen last_tracking_ping bijwerken bij validatie
  if (validationTest === true) {
    const { error: pingError } = await supabase
      .from('profiles')
      .update({ last_tracking_ping: new Date().toISOString() })
      .eq('id', projectId);

    if (pingError) {
      console.warn('⚠️ Kon last_tracking_ping niet bijwerken tijdens validatie:', pingError.message);
    } else {
      console.log(`✅ last_tracking_ping geüpdatet voor validatie van project ${projectId}`);
    }

    return res.status(200).json({ success: true, validation: true });
  }

  // ⏺️ Bezoek opslaan in leads
  const { error } = await supabase
    .from('leads')
    .insert({
      user_id: projectId,
      site_id: siteId || null,
      page_url: pageUrl,
      ip_address: ipAddress,
      source: 'tracker',
      anon_id: anonId || null,
      duration_seconds: durationSeconds || null,
      utm_source: utmSource || null,
      utm_medium: utmMedium || null,
      utm_campaign: utmCampaign || null,
      referrer: referrer || null,
      timestamp: new Date().toISOString()
    });

  if (error) {
    console.error('❌ Fout bij insert in leads:', error.message);
    return res.status(500).json({ error: error.message });
  }

  // ✅ Laatste tracking ping opslaan (voor metingen)
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ last_tracking_ping: new Date().toISOString() })
    .eq('id', projectId);

  if (updateError) {
    console.warn('⚠️ Kon last_tracking_ping niet bijwerken:', updateError.message);
  } else {
    console.log(`✅ last_tracking_ping geüpdatet voor project ${projectId}`);
  }

  return res.status(200).json({ success: true });
}
