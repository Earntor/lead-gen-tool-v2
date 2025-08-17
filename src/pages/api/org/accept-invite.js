// pages/api/org/accept-invite.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient';
import { getUserFromRequest } from '../../../lib/getUserFromRequest';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { user } = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token_required' });

  const { data: invite, error: invErr } = await supabaseAdmin
    .from('organization_invites')
    .select('*')
    .eq('token', token)
    .is('accepted_at', null)
    .single();

  if (invErr || !invite) return res.status(400).json({ error: 'invalid_or_used_token' });
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'invite_expired' });
  }

  // Voeg toe als member (idempotent)
  const { error: memErr } = await supabaseAdmin
    .from('organization_members')
    .upsert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
    }, { onConflict: 'org_id,user_id' });

  if (memErr) return res.status(400).json({ error: memErr.message });

  // Zet current_org_id (handig)
  await supabaseAdmin
    .from('profiles')
    .update({ current_org_id: invite.org_id })
    .eq('id', user.id);

  // Markeer accepted
  await supabaseAdmin
    .from('organization_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return res.status(200).json({ ok: true, org_id: invite.org_id });
}
