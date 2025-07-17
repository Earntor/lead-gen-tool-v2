import { supabaseAdmin } from '../../lib/supabaseAdminClient'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { ip_address, user_id, page_url } = req.body

  try {
    console.log('--- API LEAD DEBUG ---')
    console.log('Request body:', { ip_address, user_id, page_url })

    // 1️⃣ IPinfo ophalen
    const ipinfoRes = await fetch(`https://ipinfo.io/${ip_address}?token=${process.env.IPINFO_TOKEN}`)
    const ipinfo = await ipinfoRes.json()

    console.log('IPinfo response:', ipinfo)

    const company_name = ipinfo.org || null
    const location = ipinfo.city && ipinfo.region ? `${ipinfo.city}, ${ipinfo.region}` : null
    const hostname = ipinfo.hostname || null

    let company_domain = null
    if (hostname && hostname.includes('.')) {
      const parts = hostname.split('.')
      company_domain = parts.slice(-2).join('.')
    }

    // 2️⃣ Nominatim ophalen en straat+huisnummer samenstellen
    let ip_street = null
    let ip_postal_code = ipinfo.postal || null
    let ip_city = ipinfo.city || null
    let ip_country = ipinfo.country || null

    if (ipinfo.loc) {
      const [lat, lon] = ipinfo.loc.split(',')
      const nominatimRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
      const nominatimData = await nominatimRes.json()

      console.log('Nominatim response:', nominatimData)

      // Combineer straat + huisnummer
      const road = nominatimData.address?.road || ''
      const houseNumber = nominatimData.address?.house_number || ''
      ip_street = `${road} ${houseNumber}`.trim() || null

      // Fallbacks: als Nominatim postcode/stad beter heeft, gebruik die
      ip_postal_code = nominatimData.address?.postcode || ip_postal_code
      ip_city = nominatimData.address?.city || nominatimData.address?.town || nominatimData.address?.village || ip_city
      ip_country = nominatimData.address?.country || ip_country
    }

    // 3️⃣ In Supabase inserten
    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert([{
        user_id,
        ip_address,
        page_url,
        company_name,
        company_domain,
        location,
        ip_street,
        ip_postal_code,
        ip_city,
        ip_country,
        timestamp: new Date().toISOString()
      }])
      .select()

    if (error) {
      console.error('Supabase insert error:', error)
      return res.status(500).json({ error: error.message || 'Database insert failed' })
    }

    const insertedRow = data[0]
    console.log('Inserted row:', insertedRow)

    // 4️⃣ KvK lookup async starten
    if (company_name) {
      fetch(`http://localhost:3000/api/kvk-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: insertedRow.id,
          company_name
        })
      }).catch(err => console.error('KvK lookup error:', err))
    }

    res.status(200).json({ success: true })
  } catch (err) {
    console.error('Server error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
 