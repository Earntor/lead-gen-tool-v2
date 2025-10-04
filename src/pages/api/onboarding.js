// pages/api/onboarding.js
import { supabaseAdmin } from '../../lib/supabaseAdminClient'

// ===== helpers ===================================================

function getBearer(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

function mergePrefs(prev = {}, patch = {}) {
  const next = { ...prev }
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      next[k] = mergePrefs(prev?.[k] || {}, v)
    } else {
      next[k] = v
    }
  }
  return next
}

const ALLOWED_ROLES = ['Sales', 'Marketing', 'Management', 'Technisch', 'Overig']

async function logEventSafe(user_id, org_id, step, meta = {}) {
  try {
    const { error } = await supabaseAdmin
      .from('onboarding_events')
      .insert({ user_id, org_id, step, meta })
    if (error) {
      const msg = (error.message || '').toLowerCase()
      const code = error.code || ''
      const relMissing = code === '42P01' || msg.includes('does not exist') || msg.includes('relation')
      if (!relMissing) console.warn('onboarding_events insert warning:', error.message)
    }
  } catch (e) {
    console.warn('onboarding_events insert exception:', e?.message || e)
  }
}

// ===== handler ===================================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const token = getBearer(req)
  if (!token) return res.status(401).json({ error: 'missing bearer token' })

  const { data: uData, error: uErr } = await supabaseAdmin.auth.getUser(token)
  if (uErr || !uData?.user) return res.status(401).json({ error: 'invalid token' })
  const user = uData.user

  // Profiel ophalen of (veilig) bootstrap
  const { data: profile0 } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, phone, preferences, current_org_id, onboarding_status')
    .eq('id', user.id)
    .maybeSingle()

  let profile = profile0
  if (!profile) {
    const { data: created, error: cErr } = await supabaseAdmin
      .from('profiles')
      .insert({ id: user.id, email: user.email ?? null, preferences: {} })
      .select('id, email, full_name, phone, preferences, current_org_id, onboarding_status')
      .single()
    if (cErr) return res.status(500).json({ error: cErr.message })
    profile = created
  }

  const orgId = profile.current_org_id || null
  let isOwner = false
  if (orgId) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('owner_user_id, last_tracking_ping')
      .eq('id', orgId)
      .maybeSingle()
    isOwner = !!org && org.owner_user_id === user.id
  }

  // ---- GET: ?action=state
  if (req.method === 'GET') {
    const action = String(req.query.action || '')
    if (action !== 'state') return res.status(400).json({ error: 'unknown GET action' })

    const prefs = profile.preferences || {}
    const onboarding = prefs.onboarding || {}

    const completedByPrefs = onboarding.completed === true
    const completedByColumn = (profile.onboarding_status || '').toLowerCase() === 'done'
    const completed = completedByPrefs || completedByColumn

    const snoozedUntil = onboarding.snoozed_until ? new Date(onboarding.snoozed_until) : null
    const now = new Date()

    const showWizard = completed
      ? false
      : (snoozedUntil && snoozedUntil > now)
        ? false
        : true

    return res.status(200).json({
      ok: true,
      showWizard,
      isOwner,
      orgId,
      profile: {
        email: profile.email,
        full_name: profile.full_name || '',
        phone: profile.phone || '',
      },
      preferences: {
        user_role: prefs.user_role || '',
        onboarding: {
          step: onboarding.step || null,
          completed, // gecombineerde vlag
          welcome_sent_at: onboarding.welcome_sent_at || null,
          snoozed_until: onboarding.snoozed_until || null,
          completed_at: onboarding.completed_at || null,
        },
      },
    })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')
  } catch {
    return res.status(400).json({ error: 'invalid JSON body' })
  }

  const action = String(body.action || '')
  const nowIso = new Date().toISOString()

  // ---- saveProfile (nu met firstName/lastName)
  if (action === 'saveProfile') {
    const firstName = String(body.firstName || '').trim()
    const lastName = String(body.lastName || '').trim()
    const phone = String(body.phone || '').trim()

    if (!firstName) return res.status(400).json({ error: 'firstName is required' })
    if (!lastName)  return res.status(400).json({ error: 'lastName is required' })

    const fullName = `${firstName} ${lastName}`.trim()

    const newPrefs = mergePrefs(profile.preferences, {
      onboarding: { step: 'profile_done' },
      profile_name: { first_name: firstName, last_name: lastName },
    })

    const { error: upErr } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: fullName,
        phone: phone || null,
        preferences: newPrefs,
        updated_at: nowIso
      })
      .eq('id', user.id)
    if (upErr) return res.status(500).json({ error: upErr.message })

    await logEventSafe(user.id, orgId, 'profile_saved', {
      first_name: firstName, last_name: lastName, phone: phone || null
    })
    return res.status(200).json({ ok: true })
  }

  // ---- saveRole (+ welkomstmail éénmalig)
  if (action === 'saveRole') {
    const role = String(body.role || '').trim()
    if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' })

    const prefs0 = profile.preferences || {}
    const alreadySent = !!prefs0?.onboarding?.welcome_sent_at

    const prefs1 = mergePrefs(prefs0, { user_role: role, onboarding: { step: 'role_done' } })
    const { error: upErr1 } = await supabaseAdmin
      .from('profiles')
      .update({ preferences: prefs1, updated_at: nowIso })
      .eq('id', user.id)
    if (upErr1) return res.status(500).json({ error: upErr1.message })

    await logEventSafe(user.id, orgId, 'role_saved', { role })

    if (!alreadySent) {
      try {
        const FROM = process.env.EMAIL_FROM || 'Leadgen <onboarding@resend.dev>'
        const API_KEY = process.env.RESEND_API_KEY
        if (!API_KEY) throw new Error('RESEND_API_KEY ontbreekt')

        const to = profile.email || user.email
        const name = profile.full_name || 'daar'
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const subject = 'Welkom bij Leadgen 🎉'
        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">
            <h2>Welkom, ${name}!</h2>
            <p>Mooi dat je start. Vanuit jouw rol <b>${role}</b> hebben we tips en rapporten klaarstaan.</p>
            <p>
              ➤ Ga naar je dashboard: <a href="${appUrl}">${appUrl}</a><br/>
              ➤ Hulp nodig met tracking of een rondleiding? Reageer op deze mail – we helpen direct.
            </p>
            <p>Succes!<br/>– Team Leadgen</p>
          </div>
        `.trim()

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [to], subject, html }),
        })

        const prefs2 = mergePrefs(prefs1, { onboarding: { welcome_sent_at: nowIso } })
        await supabaseAdmin.from('profiles').update({ preferences: prefs2, updated_at: nowIso }).eq('id', user.id)

        await logEventSafe(user.id, orgId, 'welcome_sent', { to, role })
      } catch (e) {
        console.warn('⚠️ welkomstmail versturen faalde:', e?.message || e)
      }
    }

    return res.status(200).json({ ok: true })
  }

  // ---- complete (niet blokkeren op tracking)
  if (action === 'complete') {
    let tracking_ok = false
    if (orgId) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('last_tracking_ping')
        .eq('id', orgId)
        .maybeSingle()
      tracking_ok = !!org?.last_tracking_ping
    }

    const prefs = mergePrefs(profile.preferences, { onboarding: { completed: true, completed_at: nowIso } })
    const { error: upErr } = await supabaseAdmin
      .from('profiles')
      .update({
        preferences: prefs,
        onboarding_status: 'done',
        updated_at: nowIso
      })
      .eq('id', user.id)
    if (upErr) return res.status(500).json({ error: upErr.message })

    await logEventSafe(user.id, orgId, 'onboarding_done', { tracking_ok })
    return res.status(200).json({ ok: true })
  }

  // ---- snooze
  if (action === 'snooze') {
    const minutes = Number(body.minutes || 60 * 24)
    const dt = new Date(Date.now() + minutes * 60 * 1000).toISOString()
    const prefs = mergePrefs(profile.preferences, { onboarding: { snoozed_until: dt } })
    const { error: upErr } = await supabaseAdmin
      .from('profiles')
      .update({ preferences: prefs, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    if (upErr) return res.status(500).json({ error: upErr.message })

    await logEventSafe(user.id, orgId, 'onboarding_snoozed', { minutes })
    return res.status(200).json({ ok: true, snoozed_until: dt })
  }

  return res.status(400).json({ error: 'unknown action' })
}
