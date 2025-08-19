// src/pages/api/org/accept.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient'
import { getUserFromRequest } from '../../../lib/getUserFromRequest'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { user } = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'not_authenticated' })

  const { token } = req.body || {}
  if (!token) return res.status(400).json({ error: 'invalid_token' })

  // Invite ophalen
  const { data: invite, error: invErr } = await supabaseAdmin
    .from('organization_invites')
    .select('*')
    .eq('token', token)
    .single()

  if (invErr || !invite) return res.status(400).json({ error: 'invalid_token' })
  if (invite.accepted_at) return res.status(400).json({ error: 'already_used' })

  // Check of verlopen
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(400).json({ error: 'invite_expired' })
  }

  // Email match
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .single()

  if (!profile || profile.email.toLowerCase() !== invite.email.toLowerCase()) {
    return res.status(400).json({ error: 'invite_email_mismatch' })
  }

  // Lidmaatschap toevoegen (idempotent)
  await supabaseAdmin
    .from('organization_members')
    .upsert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
    })

  // Markeer invite als gebruikt
  await supabaseAdmin
    .from('organization_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  // Zet current_org_id zodat dashboard goed laadt
  await supabaseAdmin
    .from('profiles')
    .update({ current_org_id: invite.org_id })
    .eq('id', user.id)

  return res.status(200).json({ ok: true })
}
