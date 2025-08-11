// /pages/api/lead-note.js
import { supabase } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  // ─── 0) Haal de JWT uit de Authorization-header ─────────────
  // In dashboard.js sturen we straks “Authorization: Bearer <token>” mee
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (token) {
    // Stel ‘m in op de Supabase-client, zodat alle calls jouw JWT gebruiken
    supabase.auth.setAuth(token);
  }

  // ─── 1) Check of de user echt ingelogd is ────────────────────
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }

  // ─── 2) POST → upsert (insert of update) ─────────────────────
  if (req.method === 'POST') {
    const { company_domain, note } = req.body;
    const timestamp = new Date().toISOString();

    const { data, error } = await supabase
      .from('lead_notes')
      .upsert(
        {
          user_id: user.id,
          company_domain,
          note,
          updated_at: timestamp,    // forceren nieuwe timestamp
        },
        { onConflict: ['user_id', 'company_domain'] }
      )
      .select('updated_at')
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, updated_at: data.updated_at });
  }

  // ─── 3) GET → haal bestaande note + updated_at op ─────────────
  if (req.method === 'GET') {
    const { company_domain } = req.query;

    const { data, error } = await supabase
      .from('lead_notes')
      .select('note, updated_at')
      .eq('user_id', user.id)
      .eq('company_domain', company_domain)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      note:       data?.note       || '',
      updated_at: data?.updated_at || null,
    });
  }

  // ─── 4) DELETE → verwijder note ───────────────────────────────
  if (req.method === 'DELETE') {
    const { company_domain } = req.body;

    const { error } = await supabase
      .from('lead_notes')
      .delete()
      .eq('user_id', user.id)
      .eq('company_domain', company_domain);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  // ─── 5) Anders: 405 Method Not Allowed ───────────────────────
  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
