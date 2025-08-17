// src/pages/api/org/members.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient'
import { getUserFromRequest } from '../../../lib/getUserFromRequest'

export default async function handler(req, res) {
  // 1) Auth
  const { user } = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'not_authenticated' })

  // 2) Huidige org
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('current_org_id')
    .eq('id', user.id)
    .single()
  if (profErr) return res.status(500).json({ error: profErr.message })
  const orgId = profile?.current_org_id
  if (!orgId) return res.status(400).json({ error: 'no_current_org' })

  // 3) Mijn membership ophalen (één keer)
  const { data: me, error: meErr } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (meErr) return res.status(500).json({ error: meErr.message })

  // 4) GET: ledenlijst (alleen voor leden)
  if (req.method === 'GET') {
    if (!me) return res.status(403).json({ error: 'not_org_member' })

    const { data: members, error: memErr } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, role, created_at')
      .eq('org_id', orgId)
    if (memErr) return res.status(500).json({ error: memErr.message })

    const ids = members.map((m) => m.user_id)
    let profiles = []
    if (ids.length) {
      const { data: profs, error: profsErr } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids)
      if (profsErr) return res.status(500).json({ error: profsErr.message })
      profiles = profs || []
    }

    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]))
    const out = members.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      since: m.created_at,
      full_name: byId[m.user_id]?.full_name || null,
      email: byId[m.user_id]?.email || null,
    }))

    return res.status(200).json({ members: out })
  }

  // 5) PUT: rol wijzigen (alleen admin)
  if (req.method === 'PUT') {
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: 'not_org_admin' })
    }

    const { target_user_id, role } = req.body || {}
    if (!target_user_id || !role) {
      return res
        .status(400)
        .json({ error: 'target_user_id_and_role_required' })
    }

    // optioneel: simpele rol-validatie
    const allowed = new Set(['admin', 'member', 'viewer'])
    if (!allowed.has(role)) {
      return res.status(400).json({ error: 'invalid_role' })
    }

    const { error } = await supabaseAdmin
      .from('organization_members')
      .update({ role })
      .eq('org_id', orgId)
      .eq('user_id', target_user_id)

    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  // 6) DELETE: member verwijderen (alleen admin)
  if (req.method === 'DELETE') {
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: 'not_org_admin' })
    }

    const { target_user_id } = req.body || {}
    if (!target_user_id) {
      return res.status(400).json({ error: 'target_user_id_required' })
    }

    const { error } = await supabaseAdmin
      .from('organization_members')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', target_user_id)

    // Let op: DB-trigger geeft nette fout als je de laatste admin zou verwijderen
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  // 7) Anders: niet toegestaan
  return res.status(405).end()
}
