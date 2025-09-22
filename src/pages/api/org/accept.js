// src/pages/api/org/accept.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient'
import { getUserFromRequest } from '../../../lib/getUserFromRequest'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { user } = await getUserFromRequest(req, res)
  if (!user) return res.status(401).json({ error: 'not_authenticated' })

  const { token } = req.body || {}
  if (!token) return res.status(400).json({ error: 'invalid_token' })

  // 1) Invite ophalen
  const { data: invite, error: invErr } = await supabaseAdmin
    .from('organization_invites')
    .select('*')
    .eq('token', token)
    .single()

  if (invErr || !invite) return res.status(400).json({ error: 'invalid_token' })
  if (invite.accepted_at) return res.status(400).json({ error: 'already_used' })
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(400).json({ error: 'invite_expired' })
  }

   // ✅ Role validatie toevoegen
  const allowedRoles = ['member', 'admin']
  if (!allowedRoles.includes(invite.role)) {
    invite.role = 'member'
  }

  // 2) Email match checken
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .single()

  if (!profile?.email || profile.email.toLowerCase() !== invite.email.toLowerCase()) {
  return res.status(400).json({ error: 'invite_email_mismatch' })
}

  // 3) Lidmaatschap toevoegen (idempotent)
  const { error: memErr } = await supabaseAdmin
    .from('organization_members')
    .upsert(
      {
        org_id: invite.org_id,
        user_id: user.id,
        role: invite.role || 'member',
      },
      { onConflict: 'org_id,user_id' } // 👈 voorkomt dubbele memberships
    )
  if (memErr) return res.status(500).json({ error: 'membership_failed' })

  // 4) Invite markeren
  await supabaseAdmin
    .from('organization_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)
    .eq('token', token)

  // 5) Zet current_org_id in profiel
  await supabaseAdmin
    .from('profiles')
    .update({ current_org_id: invite.org_id })
    .eq('id', user.id)

  // 6) Return met extra context
  return res.status(200).json({
    ok: true,
    org_id: invite.org_id,
    role: invite.role || 'member',
  })
}
