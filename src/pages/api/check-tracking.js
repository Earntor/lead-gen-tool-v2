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
  // CORS (mag blijven; je callt same-origin, maar dit schaadt niet)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Id')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { projectId, siteId } = req.query

  // ✅ VEREIS USER JWT en valideer org-toegang
  const token = getBearer(req)
  if (!token) return res.status(401).json({ error: 'missing bearer token' })

  // user ophalen uit JWT
  const { data: uData, error: uErr } = await supabase.auth.getUser(token)
  if (uErr || !uData?.user) return res.status(401).json({ error: 'invalid token' })
  const uid = uData.user.id

  // user → profiel → huidige org
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('current_org_id')
    .eq('id', uid)
    .maybeSingle()

  if (pErr) return res.status(500).json({ error: pErr.message })
  const currentOrgId = profile?.current_org_id || null
  if (!currentOrgId) return res.status(403).json({ error: 'no org on profile' })

  try {
    if (siteId) {
      // 🔎 Check specifieke site, maar **alleen** als die site bij de org van de user hoort
      const { data: site, error } = await supabase
        .from('sites')
        .select('site_id, first_ping_at, org_id')
        .eq('site_id', String(siteId))
        .maybeSingle()

      if (error) return res.status(500).json({ error: error.message })
      if (!site || String(site.org_id) !== String(currentOrgId)) {
        return res.status(403).json({ error: 'forbidden' })
      }

      if (site.first_ping_at) {
        return res.status(200).json({
          status: 'ok',
          mode: 'site',
          siteId: site.site_id,
          first_ping_at: site.first_ping_at
        })
      }
      return res.status(200).json({ status: 'not_found', mode: 'site' })
    }

    // 🔎 Standaard: check op organisatieniveau (minstens 1 site met first_ping_at)
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required (organization id)' })
    }

    // user mag alleen zijn eigen org checken
    if (String(projectId) !== String(currentOrgId)) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const { data: anyVerifiedSite, error } = await supabase
      .from('sites')
      .select('site_id, first_ping_at')
      .eq('org_id', String(projectId))
      .not('first_ping_at', 'is', null)
      .limit(1)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })

    if (anyVerifiedSite) {
      return res.status(200).json({
        status: 'ok',
        mode: 'org',
        siteId: anyVerifiedSite.site_id,
        first_ping_at: anyVerifiedSite.first_ping_at
      })
    }

    return res.status(200).json({ status: 'not_found', mode: 'org' })
  } catch (err) {
    console.error('❌ check-tracking error:', err)
    return res.status(500).json({ error: 'Unexpected error' })
  }
}
