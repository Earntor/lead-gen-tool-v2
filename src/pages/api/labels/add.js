// src/pages/api/labels/add.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'not_authenticated' });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // 1) Auth check
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ error: 'not_authenticated' });
    }
    const userId = userData.user.id;

    // 2) Haal org_id van de user (en forceer deze bij insert)
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('current_org_id')
      .eq('id', userId)
      .single();

    if (profErr || !profile?.current_org_id) {
      return res.status(400).json({ error: 'no_active_org' });
    }
    const orgId = profile.current_org_id;

    // 3) Input schoonmaken
    const { label, color, companyName = null } = req.body || {};
    const cleanLabel = String(label || '').trim();
    const cleanColor = typeof color === 'string' && color.trim() ? color.trim() : null;
    if (!cleanLabel) return res.status(400).json({ error: 'label_required' });

    // 4) Insert MET org_id en direct de row terughalen (primary)
    const { data, error } = await supabase
      .from('labels')
      .insert({
        org_id: orgId,                // <-- cruciaal: expliciet zetten
        company_name: companyName ?? null, // null = globaal label
        label: cleanLabel,
        color: cleanColor,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'label_already_exists' });
      }
      return res.status(400).json({ error: error.message || 'insert_failed' });
    }

    return res.status(200).json(data);
  } catch (e) {
    console.error('labels/add error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
