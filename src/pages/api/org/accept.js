// src/pages/api/org/accept.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient'
import { getUserFromRequest } from '../../../lib/getUserFromRequest'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // 1) Auth + payload
  const { user } = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'not_authenticated' })

  const { token } = req.body || {}
  const rawToken = String(token || '').trim()
  if (!rawToken) return res.status(400).json({ error: 'invalid_or_used_token' })

  // 2) Invite ophalen op token
  const { data: invite, error: invErr } = await supabaseAdmin
    .from('organization_invites')
    .select('id, org_id, email, role, expires_at, accepted_at')
    .eq('token', rawToken)
    .single()

  if (invErr || !invite) {
    return res.status(400).json({ error: 'invalid_or_used_token' })
  }

  // 3) Reeds gebruikt?
  if (invite.accepted_at) {
    return res.status(400).json({ error: 'invalid_or_used_token' })
  }

  // 4) Verlopen?
  const now = new Date()
  const expires = new Date(invite.expires_at)
  if (Number.isNaN(expires.getTime()) || expires.getTime() < now.getTime()) {
    return res.status(400).json({ error: 'invite_expired' })
  }

  // 5) E-mail matchen (case-insensitive)
  //    Haal actuele e-mail van ingelogde user op uit auth.users
  const { data: authUser, error: authErr } = await supabaseAdmin
    .from('profiles')
    .select('email, current_org_id')
    .eq('id', user.id)
    .single()

  if (authErr || !authUser?.email) {
    // Als je geen profiles.email bijhoudt, haal direct via auth API op.
    // Maar in jouw setup staat email in profiles.
    return res.status(400).json({ error: 'invite_email_mismatch' })
  }

  const invitedEmail = String(invite.email || '').trim().toLowerCase()
  const sessionEmail = String(authUser.email || '').trim().toLowerCase()

  if (!invitedEmail || invitedEmail !== sessionEmail) {
    return res.status(400).json({ error: 'invite_email_mismatch' })
  }

  // 6) (Optioneel) Voorkom dat iemand met bestaande org-koppeling accepteert
  //     — volgens je front-end wil je hiervoor error 'already_in_another_org' tonen
  if (authUser.current_org_id && authUser.current_org_id !== invite.org_id) {
    // Als je multi-org wilt toestaan, haal dit blok dan weg.
    return res.status(400).json({ error: 'already_in_another_org' })
  }

  // 7) Al lid? (idempotent)
  const { data: alreadyMember } = await supabaseAdmin
    .from('organization_members')
    .select('org_id, user_id')
    .eq('org_id', invite.org_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!alreadyMember) {
    // 8) Lid maken. Je triggers kunnen hier limieten afdwingen.
    //    Als limiet wordt overschreden, geeft Postgres/trigger een fout terug.
    const { error: addErr } = await supabaseAdmin
      .from('organization_members')
      .insert({
        org_id: invite.org_id,
        user_id: user.id,
        role: invite.role, // rol van de invite
      })

    if (addErr) {
      const msg = (addErr.message || '').toLowerCase()
      // Vang een member-limiet of vergelijkbare trigger-fout af met jouw foutcode:
      if (msg.includes('max') || msg.includes('limit') || msg.includes('enforce_max_members')) {
        return res.status(400).json({ error: 'org_member_limit_reached' })
      }
      // Dubbele insert is oké (unique pk), maar die case hebben we al uitgesloten via check hierboven.
      return res.status(400).json({ error: addErr.message || 'join_failed' })
    }
  }

  // 9) Invite markeren als geaccepteerd (ook idempotent)
  const { error: updInvErr } = await supabaseAdmin
    .from('organization_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  if (updInvErr) {
    // Niet kritisch voor membership, maar goed om te melden
    // (We geven alsnog success terug, want lidmaatschap is gelukt)
    return res.status(200).json({ ok: true, warning: 'invite_mark_failed' })
  }

  // 10) current_org_id zetten als leeg
  if (!authUser.current_org_id) {
    await supabaseAdmin
      .from('profiles')
      .update({ current_org_id: invite.org_id })
      .eq('id', user.id)
  }

  return res.status(200).json({ ok: true })
}
