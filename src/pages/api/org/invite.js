// src/pages/api/org/invite.js
import crypto from 'crypto'
import { supabaseAdmin } from '../../../lib/supabaseAdminClient'
import { getUserFromRequest } from '../../../lib/getUserFromRequest'
import { Resend } from 'resend'

// Let op: Pages API draait standaard in Node runtime (NIET Edge).
// Zorg dat je hier GEEN `export const runtime = 'edge'` hebt staan.

const resend = new Resend(process.env.RESEND_API_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { user } = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'not_authenticated' })

  let { email, role = 'member' } = req.body || {}
  const normEmail = String(email || '').trim().toLowerCase()
  if (!normEmail) return res.status(400).json({ error: 'email_required' })

  // Huidige org van de aanvrager
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('current_org_id')
    .eq('id', user.id)
    .single()
  if (profErr) return res.status(500).json({ error: profErr.message })
  const orgId = profile?.current_org_id
  if (!orgId) return res.status(400).json({ error: 'no_current_org' })

  // Is de aanvrager admin binnen deze org?
  const { data: me, error: meErr } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single()
  if (meErr || !me || me.role !== 'admin') {
    return res.status(403).json({ error: 'not_org_admin' })
  }

  // Als e-mailadres al lid is: stoppen
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

  // Org-naam (voor in de mail)
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()
  const orgName = org?.name || 'je organisatie'

  // Base-URL (prod of lokaal)
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['host']
  const base = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`

  // Bestaande open invite zoeken (case-insensitive op email)
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
    // Open invite bestaat → verlengen + rol bijwerken
    token = existing.token
    const { error: updErr } = await supabaseAdmin
      .from('organization_invites')
      .update({ expires_at: newExpires, role })
      .eq('id', existing.id)
    if (updErr) return res.status(400).json({ error: updErr.message })
    inviteId = existing.id
  } else {
    // Nieuwe invite aanmaken
    token = crypto.randomBytes(24).toString('hex')
    const { data: ins, error: insErr } = await supabaseAdmin
      .from('organization_invites')
      .insert({
        org_id: orgId,
        email: normEmail, // altijd lowercase wegschrijven
        role,
        token,
        invited_by: user.id,
        expires_at: newExpires,
      })
      .select('id')
      .single()

    if (insErr) {
      const msg = String(insErr.message || '')
      // Fallback als unique constraint triggert (oude invites met hoofdletters)
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

  // --- MAIL VERSTUREN (Resend) ---
  if (!process.env.RESEND_API_KEY) {
    // Server env ontbreekt → mail kan nooit werken
    return res.status(500).json({ ok: false, error: 'resend_key_missing', inviteId, inviteUrl })
  }

  const from = process.env.EMAIL_FROM || 'LeadGen <onboarding@resend.dev>'

  try {
    const result = await resend.emails.send({
      from,
      to: normEmail,
      subject: `Uitnodiging voor ${orgName}`,
      // Plain-text voor deliverability
      text: `Je bent uitgenodigd om mee te werken in ${orgName}.

Accepteer je uitnodiging via:
${inviteUrl}

Let op: deze link verloopt over ${expiryDays} dagen.`,
      // HTML-versie
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

    // Handig voor debugging in (Vercel) logs
    console.log('Resend sent invite', { to: normEmail, id: result?.id })

    return res.status(200).json({
      ok: true,
      inviteId,
      inviteUrl,
      emailed: true,
      messageId: result?.id || null,
    })
  } catch (mailErr) {
    // Log Resend fout voor snelle diagnose
    console.error('Resend error', {
      name: mailErr?.name,
      message: mailErr?.message,
      cause: mailErr?.cause,
      response: mailErr?.response,
    })

    // Fallback: invite is geldig, geef de link terug zodat UI "Kopieer link" kan tonen
    return res.status(200).json({
      ok: true,
      inviteId,
      inviteUrl,
      emailed: false,
      warning: 'email_send_failed',
      details: mailErr?.message || 'unknown_resend_error',
    })
  }
}
