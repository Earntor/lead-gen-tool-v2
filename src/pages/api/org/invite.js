// pages/api/org/invite.js
import crypto from 'crypto';
import { supabaseAdmin } from '../../../lib/supabaseAdminClient';
import { getUserFromRequest } from '../../../lib/getUserFromRequest';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { user } = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  const { email, role = 'member' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email_required' });

  // current_org_id ophalen
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles').select('current_org_id, full_name').eq('id', user.id).single();
  if (profErr) return res.status(500).json({ error: profErr.message });
  const orgId = profile?.current_org_id;
  if (!orgId) return res.status(400).json({ error: 'no_current_org' });

  const { data: me, error: meErr } = await supabaseAdmin
  .from('organization_members')
  .select('role')
  .eq('org_id', orgId)
  .eq('user_id', user.id)
  .single()

if (meErr || !me || me.role !== 'admin') {
  return res.status(403).json({ error: 'not_org_admin' })
}


  // maak token + verloop
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const { error: insErr, data: invite } = await supabaseAdmin
    .from('organization_invites')
    .insert({
      org_id: orgId,
      email,
      role,
      token,
      invited_by: user.id,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (insErr) return res.status(400).json({ error: insErr.message });

  // Kopieerbare link teruggeven (mail is optioneel)
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const inviteUrl = `${base}/invite/accept?token=${encodeURIComponent(token)}`;
  return res.status(200).json({ ok: true, inviteUrl, expiresAt });
}
