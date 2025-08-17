// pages/api/org/update-org.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient';
import { getUserFromRequest } from '../../../lib/getUserFromRequest';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { user } = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('current_org_id').eq('id', user.id).single();
  const orgId = profile?.current_org_id;
  if (!orgId) return res.status(400).json({ error: 'no_current_org' });

// nieuwe, betrouwbare check op basis van jouw user.id
const { data: me, error: meErr } = await supabaseAdmin
  .from('organization_members')
  .select('role')
  .eq('org_id', orgId)
  .eq('user_id', user.id)
  .single()

if (meErr || !me || me.role !== 'admin') {
  return res.status(403).json({ error: 'not_org_admin' })
}


  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ name: name.trim() })
    .eq('id', orgId);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
