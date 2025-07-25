import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  // ✅ CORS headers toestaan voor externe tracking
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }

  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const {
    projectId,        // = user_id
    siteId,           // optioneel, extra controle
    pageUrl,
    anonId,
    durationSeconds,
    utmSource,
    utmMedium,
    utmCampaign,
    referrer
  } = req.body

  if (!projectId || !pageUrl) {
    return res.status(400).json({ error: "projectId and pageUrl are required" })
  }

  try {
    const url = new URL(pageUrl)
    if (url.hostname.endsWith("vercel.app")) {
      console.log("❌ Dashboard bezoek genegeerd in backend:", pageUrl)
      return res.status(200).json({ success: true, message: "Dashboard visit ignored" })
    }
  } catch (e) {
    console.warn("⚠️ Ongeldige pageUrl ontvangen, genegeerd:", pageUrl)
    return res.status(200).json({ success: true, message: "Invalid pageUrl ignored" })
  }

  // IP ophalen
  const ipAddress =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket?.remoteAddress ||
    null

  if (!ipAddress) {
    console.warn("⚠️ Geen IP-adres gevonden voor tracker hit.")
  }

  // Fallbacks
  const anonIdSafe = anonId || null
  const referrerSafe = referrer || null

  const { error } = await supabase
    .from("leads")
    .insert({
      user_id: projectId,
      site_id: siteId || null,
      page_url: pageUrl,
      ip_address: ipAddress,
      source: "tracker",
      anon_id: anonIdSafe,
      duration_seconds: durationSeconds || null,
      utm_source: utmSource || null,
      utm_medium: utmMedium || null,
      utm_campaign: utmCampaign || null,
      referrer: referrerSafe,
      timestamp: new Date().toISOString()
    })

  if (error) {
    console.error("❌ Supabase error:", error)
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ success: true })
}
