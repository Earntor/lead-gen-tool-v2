// src/pages/api/org/invite-info.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { token } = req.body || {}
  const rawToken = String(token || '').trim()
  if (!rawToken) return res.status(400).json({ error: 'invalid_or_used_token' })

  const { data: invite, error } = await supabaseAdmin
    .from('organization_invites')
    .select('id, org_id, email, role, expires_at, accepted_at')
    .eq('token', rawToken)
    .single()

  if (error || !invite) {
    return res.status(400).json({ error: 'invalid_or_used_token' })
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
  return res.status(400).json({ error: 'invite_expired' })
}

if (invite.accepted_at) {
  // frontend verwacht 'invalid_or_used_token'
  return res.status(400).json({ error: 'invalid_or_used_token' })
}

  // ✅ Alleen info teruggeven
  return res.json({
    email: invite.email,
    org_id: invite.org_id,
    role: invite.role,
  })
}
