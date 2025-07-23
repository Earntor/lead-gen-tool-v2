import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
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

  // IP ophalen
  const ipAddress =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket?.remoteAddress ||
    null

  // Opslaan in leads
  const { error } = await supabase
    .from("leads")
    .insert({
  user_id: projectId,
  site_id: siteId || null,
  page_url: pageUrl,
  ip_address: ipAddress,
  source: "tracker",
      anon_id: anonId || null,
      duration_seconds: durationSeconds || null,
      utm_source: utmSource || null,
      utm_medium: utmMedium || null,
      utm_campaign: utmCampaign || null,
      referrer: referrer || null,
      timestamp: new Date().toISOString()
    })

  if (error) {
    console.error("Supabase error:", error)
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ success: true })
}
