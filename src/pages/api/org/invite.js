// src/pages/api/org/invite.js
import crypto from 'crypto'
import { supabaseAdmin } from '../../../lib/supabaseAdminClient'
import { getUserFromRequest } from '../../../lib/getUserFromRequest'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { user } = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'not_authenticated' })

  let { email, role = 'member' } = req.body || {}
  const normEmail = String(email || '').trim().toLowerCase()
  if (!normEmail) return res.status(400).json({ error: 'email_required' })

  // Huidige org
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('current_org_id')
    .eq('id', user.id)
    .single()
  if (profErr) return res.status(500).json({ error: profErr.message })
  const orgId = profile?.current_org_id
  if (!orgId) return res.status(400).json({ error: 'no_current_org' })

  // Admin check
  const { data: me, error: meErr } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single()
  if (meErr || !me || me.role !== 'admin') {
    return res.status(403).json({ error: 'not_org_admin' })
  }

  // Als email al lid is: stop
  const { data: profByEmail } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', normEmail)
    .maybeSingle()
  if (profByEmail) {
    const { data: already } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('user_id', profByEmail.id)
      .maybeSingle()
    if (already) return res.status(409).json({ error: 'already_member' })
  }

  // Org-naam
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()
  const orgName = org?.name || 'je organisatie'

  // Base URL (prod of lokaal)
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['host']
  const base = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`

  // Open invite (case-insensitive)
  const { data: existing } = await supabaseAdmin
    .from('organization_invites')
    .select('id, token')
    .eq('org_id', orgId)
    .ilike('email', normEmail)
    .is('accepted_at', null)
    .maybeSingle()

  const expiryDays = 7
  const newExpires = new Date(Date.now() + expiryDays * 24 * 3600 * 1000).toISOString()

  let inviteId, token

  if (existing) {
    token = existing.token
    const { error: updErr } = await supabaseAdmin
      .from('organization_invites')
      .update({ expires_at: newExpires, role })
      .eq('id', existing.id)
    if (updErr) return res.status(400).json({ error: updErr.message })
    inviteId = existing.id
  } else {
    token = crypto.randomBytes(24).toString('hex')
    const { data: ins, error: insErr } = await supabaseAdmin
      .from('organization_invites')
      .insert({
        org_id: orgId,
        email: normEmail,
        role,
        token,
        invited_by: user.id,
        expires_at: newExpires,
      })
      .select('id')
      .single()

    if (insErr) {
      const msg = String(insErr.message || '')
      if (msg.includes('idx_org_invites_unique_open_email') || insErr.code === '23505') {
        const { data: again } = await supabaseAdmin
          .from('organization_invites')
          .select('id, token')
          .eq('org_id', orgId)
          .ilike('email', normEmail)
          .is('accepted_at', null)
          .single()
        if (!again) return res.status(400).json({ error: 'invite_already_open' })
        inviteId = again.id
        token = again.token
      } else {
        return res.status(400).json({ error: msg })
      }
    } else {
      inviteId = ins.id
    }
  }

  const inviteUrl = `${base}/invite/accept?token=${encodeURIComponent(token)}`

  // --- MAIL VERSTUREN met Resend SDK v3: { data, error } ---
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ ok: false, error: 'resend_key_missing', inviteId, inviteUrl })
  }

  const from = process.env.EMAIL_FROM || 'LeadGen <onboarding@resend.dev>'

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: normEmail,
      subject: `Uitnodiging voor ${orgName}`,
      text: `Je bent uitgenodigd om mee te werken in ${orgName}.

Accepteer je uitnodiging via:
${inviteUrl}

Let op: deze link verloopt over ${expiryDays} dagen.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height:1.5;">
          <p>Je bent uitgenodigd om mee te werken in <strong>${orgName}</strong>.</p>
          <p>
            <a href="${inviteUrl}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#111;color:#fff;text-decoration:none">
              Uitnodiging accepteren
            </a>
          </p>
          <p>Of kopieer deze link: <a href="${inviteUrl}">${inviteUrl}</a></p>
          <p>Deze link verloopt over ${expiryDays} dagen.</p>
        </div>
      `,
    })

    if (error) {
      // SDK gooit niet, maar retourneert error hier.
      console.error('Resend returned error', {
        name: error.name,
        message: error.message,
        cause: error.cause,
      })
      return res.status(200).json({
        ok: true,
        inviteId,
        inviteUrl,
        emailed: false,
        warning: 'email_send_failed',
        details: error.message || 'unknown_resend_error',
      })
    }

    console.log('Resend sent invite', { to: normEmail, id: data?.id })

    return res.status(200).json({
      ok: true,
      inviteId,
      inviteUrl,
      emailed: true,
      messageId: data?.id || null,
    })
  } catch (mailErr) {
    // Alleen voor onverwachte exceptions (netwerk/runtime)
    console.error('Resend exception', {
      name: mailErr?.name,
      message: mailErr?.message,
      cause: mailErr?.cause,
      response: mailErr?.response,
    })

    return res.status(200).json({
      ok: true,
      inviteId,
      inviteUrl,
      emailed: false,
      warning: 'email_send_failed',
      details: mailErr?.message || 'unknown_resend_exception',
    })
  }
}
