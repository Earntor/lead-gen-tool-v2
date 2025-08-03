export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { token } = req.body
    const secret = process.env.RECAPTCHA_SECRET_KEY

    if (!token || !secret) {
      return res.status(400).json({ error: 'Token of geheime sleutel ontbreekt' })
    }

    const params = new URLSearchParams()
    params.append('secret', secret)
    params.append('response', token)

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    const data = await response.json()

    // 👇 Log alles zodat je weet wat fout is
    console.log('🔍 Google reCAPTCHA respons:', JSON.stringify(data, null, 2))

    if (!data.success) {
      return res.status(200).json({ success: false, errorCodes: data['error-codes'] || [] })
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('❌ Fout bij verificatie reCAPTCHA:', err)
    return res.status(500).json({ error: 'Interne serverfout' })
  }
}
