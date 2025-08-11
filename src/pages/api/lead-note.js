// /pages/api/lead-note.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 0) Token uit Authorization header (Bearer <jwt>)
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Niet ingelogd (geen token gevonden)' });
  }

  // 1) Maak per request een server-side Supabase client met deze JWT
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    }
  );

  // 2) Valideer user
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user || null;

  if (userError || !user) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }

  // 3) Method router
  try {
    if (req.method === 'POST') {
      // Upsert (insert of update) van note
      const { company_domain, note } = req.body || {};
      if (!company_domain || typeof company_domain !== 'string') {
        return res.status(400).json({ error: 'company_domain ontbreekt of is ongeldig' });
      }

      // We forceren updated_at hier; je kunt ook een DB-trigger gebruiken (zie stap 2 hieronder)
      const timestamp = new Date().toISOString();

      const { data, error } = await supabase
        .from('lead_notes')
        .upsert(
          {
            user_id: user.id,
            company_domain,
            note: note ?? '',
            updated_at: timestamp,
          },
          // Let op: onConflict verwacht een string, geen array
          { onConflict: 'user_id,company_domain' }
        )
        .select('note, updated_at')
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        note: data?.note ?? '',
        updated_at: data?.updated_at ?? timestamp,
      });
    }

    if (req.method === 'GET') {
      // Haal bestaande note op
      const { company_domain } = req.query || {};
      if (!company_domain || typeof company_domain !== 'string') {
        return res.status(400).json({ error: 'company_domain ontbreekt of is ongeldig' });
      }

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
        note: data?.note ?? '',
        updated_at: data?.updated_at ?? null,
      });
    }

    if (req.method === 'DELETE') {
      // Verwijder note
      const { company_domain } = req.body || {};
      if (!company_domain || typeof company_domain !== 'string') {
        return res.status(400).json({ error: 'company_domain ontbreekt of is ongeldig' });
      }

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

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Onbekende fout' });
  }
}
