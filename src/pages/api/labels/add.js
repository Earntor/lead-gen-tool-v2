// src/pages/api/labels/add.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'not_authenticated' });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) return res.status(401).json({ error: 'not_authenticated' });

    const { data: prof, error: profErr } = await supabase
      .from('profiles')
      .select('current_org_id')
      .eq('id', userData.user.id)
      .single();
    if (profErr || !prof?.current_org_id) return res.status(400).json({ error: 'no_active_org' });

    const { label, color, companyName = null } = req.body || {};
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) return res.status(400).json({ error: 'label_required' });

    const { data, error } = await supabase
      .from('labels')
      .insert({
        org_id: prof.current_org_id,                 // org-gebonden
        company_name: (companyName || '').trim() || null, // null = globaal label
        label: cleanLabel,
        color: (typeof color === 'string' && color.trim()) ? color.trim() : null,
      })
      .select('*')
      .single();

    if (error) {
      return res
        .status(error.code === '23505' ? 409 : 400)
        .json({ error: error.code === '23505' ? 'label_already_exists' : (error.message || 'insert_failed') });
    }

    return res.status(201).json(data);
  } catch (e) {
    console.error('labels/add error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
