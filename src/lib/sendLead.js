// lib/sendLead.js

export async function sendLead({ user_id, page_url }) {
  try {
    // 🔍 Haal het IP-adres van de bezoeker op
    const ipRes = await fetch('https://api.ipify.org?format=json')
    const ipData = await ipRes.json()
    const ip_address = ipData.ip

    // 📤 Verstuur de lead naar je eigen API
    const res = await fetch('/api/lead', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id,
        ip_address,
        page_url,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Fout bij opslaan lead')
    }

    console.log('✅ Lead verstuurd:', data.message)
  } catch (err) {
    console.error('❌ Fout bij versturen lead:', err.message)
  }
}
