import { supabaseAdmin } from '../../lib/supabaseAdminClient'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { ip, email, site_id } = req.body

  if (!email || !ip || !site_id) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const domain = email.split('@')[1]?.toLowerCase()

  try {
    // Log in form_submission_log
    const { error: logError } = await supabaseAdmin
      .from('form_submission_log')
      .insert([{
        ip,
        email,
        domain,
        site_id,
        timestamp: new Date().toISOString()
      }])

    if (logError) {
      console.error('Insert error:', logError)
      return res.status(500).json({ error: 'Failed to log submission' })
    }

    // Voeg harde match toe aan ip_company_map met confidence 1.0
    const { error: mapError } = await supabaseAdmin
      .from('ip_company_map')
      .upsert({
        ip,
        company_name: domain, // of laat dit leeg
        domain,
        confidence: 1.0,
        source: 'form_submission',
        first_seen: new Date().toISOString(),
        last_updated: new Date().toISOString()
      })

    if (mapError) {
      console.error('Map insert error:', mapError)
      return res.status(500).json({ error: 'Failed to update mapping' })
    }

    res.status(200).json({ success: true })
  } catch (err) {
    console.error('Server error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
