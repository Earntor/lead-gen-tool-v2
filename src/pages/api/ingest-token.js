// pages/api/ingest-token.js
import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const INGEST_JWT_SECRET = process.env.INGEST_JWT_SECRET

// ---- Bot UA helper (conservatief) ----
const BOT_UA = [
  'bot','spider','crawl','slurp',
  'bingbot','bingpreview',
  'googlebot','applebot','baiduspider',
  'yandex','yandexbot',
  'duckduckbot',
  'vercel-screenshot-bot','vercel-favicon-bot'
]
function isBotUA(ua) {
  if (!ua) return false
  const s = ua.toLowerCase()
  return BOT_UA.some(k => s.includes(k))
}

export default async function handler(req, res) {
  // CORS + anti-index + response meta
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Id')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Vary', 'Origin, Referer, User-Agent')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!INGEST_JWT_SECRET) {
    return res.status(500).json({ error: 'missing INGEST_JWT_SECRET' })
  }

  // 🛡️ Vroege bot-cutoff (scheelt Edge-requests/compute)
  const ua = req.headers['user-agent'] || ''
  if (isBotUA(ua)) {
    return res.status(204).end()
  }

  // Query parameters
  const siteId = String((req.query.site || '')).toLowerCase().trim()
  const projectId = (req.query.projectId || '').trim()
  if (!siteId) {
    return res.status(400).json({ error: 'site required' })
  }

  // 🔐 Referer check (host moet overeenkomen met siteId of subdomein daarvan)
  const referer = req.headers.referer || ''
  try {
    const refHost = referer ? new URL(referer).hostname.toLowerCase() : null
    const isLocalDev =
      refHost === 'localhost' ||
      refHost === '127.0.0.1' ||
      (refHost && refHost.endsWith('.localhost'))

    if (
      refHost &&                       // alleen checken als er een referer is
      !isLocalDev &&
      refHost !== siteId &&
      !refHost.endsWith('.' + siteId)
    ) {
      return res.status(403).json({ error: 'referer mismatch' })
    }
  } catch {
    // Geen geldige referer → laten we toe
  }

  // 🧠 Lookup org_id met subdomein → apex fallback
  let orgId = null
  try {
    // 1) exacte hostmatch op sites.site_id
    let { data: row, error } = await supabase
      .from('sites')
      .select('org_id')
      .eq('site_id', siteId)
      .maybeSingle()

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: 'site lookup failed' })
    }

    if (row?.org_id) {
      orgId = row.org_id
    } else {
      // 2) fallback: basisdomein match op sites.domain_name
      // bv. shop.klant.nl → klant.nl
      const base = siteId.replace(/^[^.]+\./, '')
      if (base && base !== siteId) {
        const { data: row2, error: err2 } = await supabase
          .from('sites')
          .select('org_id')
          .eq('domain_name', base)
          .maybeSingle()

        if (err2 && err2.code !== 'PGRST116') {
          return res.status(500).json({ error: 'site fallback lookup failed' })
        }
        if (row2?.org_id) orgId = row2.org_id
      }
    }

    if (!orgId) {
      return res.status(400).json({ error: 'site not linked to any org' })
    }
  } catch {
    return res.status(500).json({ error: 'org lookup failed' })
  }

  // ⏱ Token maken (1 uur geldig)
  const now = Math.floor(Date.now() / 1000)
  const token = jwt.sign(
    {
      sub: `ingest:${siteId}`,
      site_id: siteId,
      org_id: orgId,                 // 👈 verplicht voor /api/track
      project_id: projectId || null, // optioneel, informatief
      iat: now,
      nbf: now - 5,
      exp: now + 3600
    },
    INGEST_JWT_SECRET,
    { algorithm: 'HS256' }
  )

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ token })
}
