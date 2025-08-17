import { supabaseAdmin } from '../../../lib/supabaseAdminClient'
import { getUserFromRequest } from '../../../lib/getUserFromRequest'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { user } = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'not_authenticated' })

  const { data: profile } = await supabaseAdmin.from('profiles').select('id,full_name,email,current_org_id').eq('id', user.id).single()
  if (profile?.current_org_id) return res.status(200).json({ ok: true, org_id: profile.current_org_id })

  const name = (profile?.full_name && profile.full_name.trim()) || profile?.email || `Organisatie ${user.id.slice(0,8)}`
  const { data: org, error: orgErr } = await supabaseAdmin.from('organizations').insert({ name, owner_user_id: user.id }).select().single()
  if (orgErr) return res.status(500).json({ error: orgErr.message })

  const { error: memErr } = await supabaseAdmin.from('organization_members').insert({ org_id: org.id, user_id: user.id, role: 'admin' })
  if (memErr) return res.status(500).json({ error: memErr.message })

  const { error: updErr } = await supabaseAdmin.from('profiles').update({ current_org_id: org.id }).eq('id', user.id)
  if (updErr) return res.status(500).json({ error: updErr.message })

  return res.status(200).json({ ok: true, org_id: org.id })
}
