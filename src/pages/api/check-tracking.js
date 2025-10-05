// pages/api/check-tracking.js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function getBearer(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Id')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { projectId, siteId } = req.query
  const RECENT_MS = 10 * 60 * 1000 // 10 minuten

  // ✅ Vereis user JWT
  const token = getBearer(req)
  if (!token) return res.status(401).json({ error: 'missing bearer token' })

  // User uit JWT
  const { data: uData, error: uErr } = await supabase.auth.getUser(token)
  if (uErr || !uData?.user) return res.status(401).json({ error: 'invalid token' })
  const uid = uData.user.id

  // User → profiel → huidige org
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('current_org_id')
    .eq('id', uid)
    .maybeSingle()

  if (pErr) return res.status(500).json({ error: pErr.message })
  const currentOrgId = profile?.current_org_id || null
  if (!currentOrgId) return res.status(403).json({ error: 'no org on profile' })

  try {
    // ----------------- SITE-SPECIFIEKE CHECK -----------------
    if (siteId) {
      // Site alleen checken als deze bij de org van de user hoort
      const { data: site, error } = await supabase
        .from('sites')
        .select('site_id, first_ping_at, last_ping_at, org_id')
        .eq('site_id', String(siteId))
        .maybeSingle()

      if (error) return res.status(500).json({ error: error.message })
      if (!site || String(site.org_id) !== String(currentOrgId)) {
        return res.status(403).json({ error: 'forbidden' })
      }

      const now = Date.now()

      if (site.last_ping_at) {
        const last = new Date(site.last_ping_at).getTime()
        if (isFinite(last) && (now - last) <= RECENT_MS) {
          return res.status(200).json({
            status: 'ok',
            mode: 'site',
            siteId: site.site_id,
            last_ping_at: site.last_ping_at
          })
        }
        // last_ping_at bestaat maar is niet recent
        return res.status(200).json({
          status: 'stale',
          mode: 'site',
          siteId: site.site_id,
          last_ping_at: site.last_ping_at
        })
      }

      // Nooit een last_ping_at → als er wél ooit een first_ping_at was, dan stale; anders not_found
      if (site.first_ping_at) {
        return res.status(200).json({
          status: 'stale',
          mode: 'site',
          siteId: site.site_id,
          last_ping_at: null
        })
      }

      return res.status(200).json({ status: 'not_found', mode: 'site' })
    }

    // ----------------- ORG-BREDE CHECK -----------------
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required (organization id)' })
    }
    if (String(projectId) !== String(currentOrgId)) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const now = Date.now()

    // 1) PRIMAIR: is er een site met recente last_ping_at? (alleen echte snippet-pings tellen)
    const { data: recentSite, error: sErr } = await supabase
      .from('sites')
      .select('site_id, last_ping_at, first_ping_at')
      .eq('org_id', String(projectId))
      .order('last_ping_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (sErr) return res.status(500).json({ error: sErr.message })

    if (recentSite?.last_ping_at) {
      const last = new Date(recentSite.last_ping_at).getTime()
      if (isFinite(last) && (now - last) <= RECENT_MS) {
        return res.status(200).json({
          status: 'ok',
          mode: 'org',
          siteId: recentSite.site_id,
          last_ping_at: recentSite.last_ping_at
        })
      }
      return res.status(200).json({
        status: 'stale',
        mode: 'org',
        siteId: recentSite.site_id,
        last_ping_at: recentSite.last_ping_at
      })
    }

    // 2) Fallback: ooit een eerste ping gezien?
    const { data: anyVerifiedSite, error: vErr } = await supabase
      .from('sites')
      .select('site_id, first_ping_at')
      .eq('org_id', String(projectId))
      .not('first_ping_at', 'is', null)
      .order('first_ping_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (vErr) return res.status(500).json({ error: vErr.message })

    if (anyVerifiedSite) {
      return res.status(200).json({
        status: 'stale',
        mode: 'org',
        siteId: anyVerifiedSite.site_id,
        first_ping_at: anyVerifiedSite.first_ping_at
      })
    }

    // Geen enkele ping ooit gezien
    return res.status(200).json({ status: 'not_found', mode: 'org' })
  } catch (err) {
    console.error('❌ check-tracking error:', err)
    return res.status(500).json({ error: 'Unexpected error' })
  }
}
