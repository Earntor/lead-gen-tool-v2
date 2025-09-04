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

    // Auth-check (RLS context)
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

    const { labelId, cascade } = req.body || {};
    if (!labelId || typeof labelId !== 'string') {
      return res.status(400).json({ error: 'Geen geldige labelId' });
    }

    // 1) Haal de te verwijderen rij op (om org_id/label te weten)
    const { data: row, error: getErr } = await supabase
      .from('labels')
      .select('id, org_id, label, company_name')
      .eq('id', labelId)
      .single();

    if (getErr || !row) return res.status(404).json({ error: 'Label niet gevonden' });

    // 2) Cataloguslabel? (company_name IS NULL) → cascade alle toewijzingen
    const doCascade = cascade !== false; // standaard true
    if (row.company_name === null && doCascade) {
      const { error: delAllErr } = await supabase
        .from('labels')
        .delete()
        .eq('org_id', row.org_id)
        .eq('label', row.label); // verwijder ook alle per-bedrijf varianten

      if (delAllErr) return res.status(500).json({ error: delAllErr.message });
      return res.status(200).json({ ok: true, deleted: 'catalog_and_assignments' });
    }

    // 3) Anders: alleen deze specifieke rij
    const { error: delOneErr } = await supabase
      .from('labels')
      .delete()
      .eq('id', row.id);

    if (delOneErr) return res.status(500).json({ error: delOneErr.message });
    return res.status(200).json({ ok: true, deleted: 'single' });

  } catch (e) {
    console.error('labels/delete error:', e);
    return res.status(502).json({ error: 'Upstream fout', detail: e?.message || String(e) });
  }
}
