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
  'bot','spider','crawl','slurp','bingpreview',
  'googlebot','applebot','baiduspider','yandex','duckduckbot',
  'vercel-screenshot-bot','vercel-favicon-bot'
]
function isBotUA(ua) {
  if (!ua) return false
  const s = ua.toLowerCase()
  return BOT_UA.some(k => s.includes(k))
}

export default async function handler(req, res) {
  // CORS + anti-index headers (veilig)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive')

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Id')
    return res.status(200).end()
  }

  // 🛡️ Vroege bot-cutoff (scheelt Edge-requests/compute)
  const ua = req.headers['user-agent'] || ''
  if (isBotUA(ua)) {
    return res.status(204).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!INGEST_JWT_SECRET) {
    return res.status(500).json({ error: 'missing INGEST_JWT_SECRET' })
  }

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
      refHost &&
      !isLocalDev &&
      refHost !== siteId &&
      !refHost.endsWith('.' + siteId)
    ) {
      return res.status(403).json({ error: 'referer mismatch' })
    }
  } catch {
    // Geen geldige referer → laten we toe
  }

  // 🧠 Lookup org_id voor dit siteId
  let orgId = null
  try {
    const { data: site, error } = await supabase
      .from('sites')
      .select('org_id')
      .eq('site_id', siteId)
      .maybeSingle()

    if (error) {
      return res.status(500).json({ error: 'site lookup failed' })
    }

    if (site?.org_id) {
      orgId = site.org_id
    } else {
      // ❌ Geen site gevonden → fout teruggeven (site moet eerst gekoppeld zijn)
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
      org_id: orgId,              // 👈 verplicht voor track.js
      project_id: projectId || null, // optioneel
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
