// /pages/api/lead-note.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Niet ingelogd (geen token gevonden)' });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    }
  );

  // 1) User ophalen
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user || null;
  if (userError || !user) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }

  // 2) Huidige org ophalen
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('current_org_id')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile?.current_org_id) {
    return res.status(400).json({ error: 'Geen organisatie gevonden' });
  }
  const orgId = profile.current_org_id;

  try {
    if (req.method === 'POST') {
      const { company_domain, note } = req.body || {};
      if (!company_domain) {
        return res.status(400).json({ error: 'company_domain ontbreekt' });
      }

      const timestamp = new Date().toISOString();

      const { data, error } = await supabase
        .from('lead_notes')
        .upsert(
          {
            org_id: orgId,                  // ✅ organisatie
            company_domain,
            note: note ?? '',
            updated_at: timestamp,
          },
          { onConflict: 'org_id,company_domain' } // ✅ unieke org+bedrijf
        )
        .select('note, updated_at')
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({
        success: true,
        note: data?.note ?? '',
        updated_at: data?.updated_at ?? timestamp,
      });
    }

    if (req.method === 'GET') {
      const { company_domain } = req.query || {};
      if (!company_domain) {
        return res.status(400).json({ error: 'company_domain ontbreekt' });
      }

      const { data, error } = await supabase
        .from('lead_notes')
        .select('note, updated_at')
        .eq('org_id', orgId)              // ✅ organisatie
        .eq('company_domain', company_domain)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({
        note: data?.note ?? '',
        updated_at: data?.updated_at ?? null,
      });
    }

    if (req.method === 'DELETE') {
      const { company_domain } = req.body || {};
      if (!company_domain) {
        return res.status(400).json({ error: 'company_domain ontbreekt' });
      }

      const { error } = await supabase
        .from('lead_notes')
        .delete()
        .eq('org_id', orgId)              // ✅ organisatie
        .eq('company_domain', company_domain);

      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Onbekende fout' });
  }
}
