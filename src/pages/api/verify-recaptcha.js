export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { token } = req.body;
    const secret = process.env.RECAPTCHA_SECRET_KEY;

    if (!token || !secret) {
      return res.status(400).json({ error: 'Token of geheime sleutel ontbreekt' });
    }

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secret}&response=${token}`,
    });

    if (!response.ok) {
      console.error('❌ reCAPTCHA verificatie faalde met status:', response.status);
      return res.status(500).json({ error: 'Verificatie mislukt bij Google' });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('❌ Fout bij verificatie reCAPTCHA:', err);
    return res.status(500).json({ error: 'Interne serverfout' });
  }
}
