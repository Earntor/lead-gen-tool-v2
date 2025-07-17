import { supabaseAdmin } from '../../lib/supabaseAdminClient'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { lead_id, company_name } = req.body

  try {
    console.log('--- KVK LOOKUP DEBUG ---')
    console.log('Looking up:', company_name)

    // KvK zoeken op handelsnaam
    const kvkRes = await fetch(
      `https://api.kvk.nl/api/v1/zoeken?handelsnaam=${encodeURIComponent(company_name)}&kvk.api.version=1.0`,
      {
        headers: {
          apikey: process.env.KVK_API_KEY
        }
      }
    )

    if (!kvkRes.ok) {
      const errText = await kvkRes.text()
      console.error('KvK fetch error:', errText)
      return res.status(500).json({ error: 'KvK fetch failed' })
    }

    const kvkData = await kvkRes.json()
    console.log('KvK response:', kvkData)

    const first = kvkData.data?.[0]
    if (!first) {
      console.log('Geen KvK-resultaat voor:', company_name)
      return res.status(200).json({ success: true, message: 'No match' })
    }

    // Adresinformatie ophalen
    const kvk_number = first.kvkNummer || null
    const kvk_street = first.adres?.straatnaam || null
    const kvk_postal_code = first.adres?.postcode || null
    const kvk_city = first.adres?.plaats || null
    const kvk_country = 'NL'

    // Update Supabase
    const { error } = await supabaseAdmin
      .from('leads')
      .update({
        kvk_number,
        kvk_street,
        kvk_postal_code,
        kvk_city,
        kvk_country
      })
      .eq('id', lead_id)

    if (error) {
      console.error('Supabase update error:', error)
      return res.status(500).json({ error: 'Database update failed' })
    }

    console.log('KvK data toegevoegd aan lead:', lead_id)

    res.status(200).json({ success: true })
  } catch (err) {
    console.error('KvK server error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
