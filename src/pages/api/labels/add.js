// /pages/api/labels/add.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return res.status(500).json({ error: 'Supabase env ontbreekt' });

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!token) return res.status(401).json({ error: 'Niet ingelogd (geen token)' });

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Auth: we hebben de user.id nodig voor user_id
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) return res.status(401).json({ error: 'Auth fout', detail: userErr.message });
    const user = userData?.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Body + validatie
    let { companyName, label, color } = req.body || {};
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) return res.status(400).json({ error: 'Label ontbreekt' });

    const cleanCompanyName =
      companyName == null ? null : (String(companyName).trim() || null);

    // Insert: laat org_id met opzet NULL → trigger zet 'm op basis van auth.uid()
    const { data, error } = await supabase
      .from('labels')
      .insert({
        user_id: user.id,
        org_id: null,                 // trg_set_org_on_labels zet dit
        company_name: cleanCompanyName,
        label: cleanLabel,
        color: color || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  } catch (e) {
    console.error('labels/add error:', e);
    return res.status(502).json({ error: 'Upstream fout', detail: e?.message || String(e) });
  }
}
