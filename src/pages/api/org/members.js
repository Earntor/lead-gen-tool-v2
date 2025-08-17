// pages/api/org/members.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient';
import { getUserFromRequest } from '../../../lib/getUserFromRequest';

export default async function handler(req, res) {
  const { user } = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  // Huidige org
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles').select('current_org_id').eq('id', user.id).single();
  if (profErr) return res.status(500).json({ error: profErr.message });
  const orgId = profile?.current_org_id;
  if (!orgId) return res.status(400).json({ error: 'no_current_org' });

  if (req.method === 'GET') {
    // leden + profielinfo
    const { data: members, error: memErr } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, role, created_at')
      .eq('org_id', orgId);
    if (memErr) return res.status(500).json({ error: memErr.message });

    const ids = members.map(m => m.user_id);
    let profiles = [];
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);
      profiles = profs || [];
    }

    const byId = Object.fromEntries(profiles.map(p => [p.id, p]));
    const out = members.map(m => ({
      user_id: m.user_id,
      role: m.role,
      since: m.created_at,
      full_name: byId[m.user_id]?.full_name || null,
      email: byId[m.user_id]?.email || null,
    }));

    return res.status(200).json({ members: out });
  }

  // Admin check voor mutaties
  const { data: isAdmin } = await supabaseAdmin.rpc('is_org_admin', { p_org: orgId });
  if (!isAdmin) return res.status(403).json({ error: 'not_org_admin' });

  if (req.method === 'PUT') {
    const { target_user_id, role } = req.body || {};
    if (!target_user_id || !role) return res.status(400).json({ error: 'target_user_id_and_role_required' });

    // Rolverandering
    const { error } = await supabaseAdmin
      .from('organization_members')
      .update({ role })
      .eq('org_id', orgId)
      .eq('user_id', target_user_id);

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { target_user_id } = req.body || {};
    if (!target_user_id) return res.status(400).json({ error: 'target_user_id_required' });

    // Verwijderen
    const { error } = await supabaseAdmin
      .from('organization_members')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', target_user_id);

    if (error) {
      // Fout bij laatste admin wordt hier netjes door DB getriggerd
      return res.status(400).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
