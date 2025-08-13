// pages/api/ingest-token.js
import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const INGEST_JWT_SECRET = process.env.INGEST_JWT_SECRET

export default async function handler(req, res) {
  // CORS + preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'GET') return res.status(405).end()

  if (!INGEST_JWT_SECRET) {
    return res.status(500).json({ error: 'missing INGEST_JWT_SECRET' })
  }

  const siteId = String((req.query.site || '')).toLowerCase().trim()
  const projectId = (req.query.projectId || '').trim()
  if (!siteId || !projectId) {
    return res.status(400).json({ error: 'site and projectId required' })
  }

  // Basic referer/host guard: blokkeer evidente cross-site misbruik
  const referer = req.headers.referer || ''
  try {
    const refHost = referer ? new URL(referer).hostname.toLowerCase() : null
    const isLocalDev =
      refHost === 'localhost' ||
      refHost === '127.0.0.1' ||
      (refHost && refHost.endsWith('.localhost'))

    // Toestaan als:
    // - dev (localhost), of
    // - referer host exact het siteId is, of een subdomein daarvan
    if (
      refHost &&
      !isLocalDev &&
      refHost !== siteId &&
      !refHost.endsWith('.' + siteId)
    ) {
      return res.status(403).json({ error: 'referer mismatch' })
    }
  } catch {
    // Geen geldige referer -> laten we toe (same-origin requests blijven werken)
  }

  // Registreer site indien niet bestaand (zelfde gedrag als /api/track)
  const { data: site, error } = await supabase
    .from('sites')
    .select('site_id')
    .eq('site_id', siteId)
    .maybeSingle()

  if (!site && !error) {
    const cleanedDomain = siteId.replace(/^www\./, '')
    const { error: insErr } = await supabase.from('sites').insert({
      site_id: siteId,
      user_id: projectId,
      domain_name: cleanedDomain
    })
    if (insErr) {
      return res.status(500).json({ error: 'site insert failed' })
    }
  } else if (error) {
    return res.status(500).json({ error: 'site lookup failed' })
  }

  // Maak kort-levend token (1 uur)
  const now = Math.floor(Date.now() / 1000)
  const token = jwt.sign(
    {
      sub: `ingest:${siteId}`,
      site_id: siteId,
      user_id: projectId,
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
