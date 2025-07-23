// pages/api/trackFormSubmission.js
import { supabaseAdmin } from '../../lib/supabaseAdminClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ip, email, site_id } = req.body;

  if (!email || !ip || !site_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const domain = cleanEmail.split('@')[1];

  if (!domain) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    // 🔹 Stap 1: log formulierverzending
    const { error: logError } = await supabaseAdmin
      .from('form_submission_log')
      .insert([
        {
          ip,
          email: cleanEmail,
          domain,
          site_id,
          timestamp: new Date().toISOString(),
        },
      ]);

    if (logError) {
      console.error('❌ Fout bij loggen in form_submission_log:', logError);
      return res.status(500).json({ error: 'Failed to log submission' });
    }

    // 🔹 Stap 2: Upsert naar ip_company_map met confidence = 1.0
    const { error: upsertError } = await supabaseAdmin
      .from('ip_company_map')
      .upsert(
        {
          ip,
          domain,
          company_name: null, // later eventueel aanvullen bij enrichment
          confidence: 1.0,
          source: 'form_submission',
          first_seen: new Date().toISOString(),
          last_updated: new Date().toISOString(),
        },
        {
          onConflict: ['ip'], // alleen als IP al bestaat, dan update
        }
      );

    if (upsertError) {
      console.error('❌ Fout bij upsert in ip_company_map:', upsertError);
      return res.status(500).json({ error: 'Failed to update mapping' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Server error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
