export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    url,
    referrer,
    utmSource,
    utmMedium,
    utmCampaign,
    timestamp
  } = req.body;

  console.log('Nieuwe tracking hit ontvangen:', {
    url,
    referrer,
    utmSource,
    utmMedium,
    utmCampaign,
    timestamp,
  });

  // Later komt hier Supabase opslag

  return res.status(200).json({ message: 'Tracking received' });
}
