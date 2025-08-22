// /pages/api/labels/delete.js
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

    // Auth-check (nodig voor RLS context)
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) return res.status(401).json({ error: 'Auth fout', detail: userErr.message });
    if (!userData?.user) return res.status(401).json({ error: 'Unauthorized' });

    const { labelId } = req.body || {};
    if (!labelId || typeof labelId !== 'string') {
      return res.status(400).json({ error: 'Geen geldige labelId' });
    }

    const { data, error } = await supabase
      .from('labels')
      .delete()
      .eq('id', labelId)     // RLS voorkomt cross-org deletes
      .select()
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Label niet gevonden' });

    return res.status(200).json(data);
  } catch (e) {
    console.error('labels/delete error:', e);
    return res.status(502).json({ error: 'Upstream fout', detail: e?.message || String(e) });
  }
}
