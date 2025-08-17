// src/pages/api/org/accept.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient'
import { getUserFromRequest } from '../../../lib/getUserFromRequest'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { user } = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'not_authenticated' })

  const { token } = req.body || {}
  if (!token) return res.status(400).json({ error: 'token_required' })

  // 1) Invite ophalen (ongebruikt + niet verlopen)
  const { data: invite, error: invErr } = await supabaseAdmin
    .from('organization_invites')
    .select('*')
    .eq('token', token)
    .is('accepted_at', null)
    .single()

  if (invErr || !invite) return res.status(400).json({ error: 'invalid_or_used_token' })
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'invite_expired' })
  }

  // 2) (Optioneel) mail-match afdwingen
  const enforceEmail = process.env.ENFORCE_INVITE_EMAIL === '1'
  if (enforceEmail) {
    const userEmail = (user.email || '').toLowerCase()
    const inviteEmail = (invite.email || '').toLowerCase()
    if (!userEmail || !inviteEmail || userEmail !== inviteEmail) {
      return res.status(403).json({ error: 'invite_email_mismatch' })
    }
  }

  // 3) Profiel ophalen om single-org regel af te dwingen
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, current_org_id')
    .eq('id', user.id)
    .single()
  if (profErr) return res.status(500).json({ error: profErr.message })

  // ❗ Single-org: als user al in een andere org zit, blokkeren we accepteren
  if (profile?.current_org_id && profile.current_org_id !== invite.org_id) {
    return res.status(409).json({ error: 'already_in_another_org' })
  }

  // 4) Lid maken (idempotent)
  const { error: memErr } = await supabaseAdmin
    .from('organization_members')
    .upsert(
      { org_id: invite.org_id, user_id: user.id, role: invite.role },
      { onConflict: 'org_id,user_id' }
    )
  if (memErr) {
    const msg = String(memErr.message || '')
    if (msg.includes('Maximaal 5 gebruikers')) {
      return res.status(400).json({ error: 'org_member_limit_reached' })
    }
    return res.status(400).json({ error: msg })
  }

  // 5) current_org_id alleen zetten als die NOG leeg is (geen auto-switch)
  if (!profile?.current_org_id) {
    await supabaseAdmin
      .from('profiles')
      .update({ current_org_id: invite.org_id })
      .eq('id', user.id)
  }

  // 6) Invite markeren als gebruikt
  await supabaseAdmin
    .from('organization_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  return res.status(200).json({ ok: true, org_id: invite.org_id })
}
