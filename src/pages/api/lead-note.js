// /pages/api/lead-note.js
import { supabase } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  // 1. Controleer of de gebruiker ingelogd is
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user || userError) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }

  // 2. Acties per HTTP-methode
  if (req.method === 'POST') {
    const { company_domain, note } = req.body;
    const timestamp = new Date().toISOString();

    // upsert: nieuwe notitie of bijwerken
    const { data, error } = await supabase
      .from('lead_notes')
      .upsert(
        {
          user_id: user.id,
          company_domain,
          note,
          updated_at: timestamp      // hier voegen we het zelf toe
        },
        { onConflict: ['user_id', 'company_domain'] }
      )
      .select('updated_at')        // vraag alleen updated_at op
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res
      .status(200)
      .json({ success: true, updated_at: data.updated_at });
  }

  if (req.method === 'GET') {
    const { company_domain } = req.query;

    // haal notitie + updated_at op
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

  // Anders 405
  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
