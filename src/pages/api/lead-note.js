// pages/api/lead-note.js
import { createClient } from '@supabase/supabase-js';

// Server-side client met SERVICE ROLE (RLS omzeilen voor eenvoud/controle hier)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Haal ingelogde user uit Bearer token
async function getUserFromAuthHeader(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

// Ophalen org_id van de gebruiker
async function getOrgIdForUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('current_org_id')
    .eq('id', userId)
    .single();
  if (error || !data?.current_org_id) return null;
  return data.current_org_id;
}

export default async function handler(req, res) {
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) return res.status(401).json({ error: 'not_authenticated' });

    const orgId = await getOrgIdForUser(user.id);
    if (!orgId) return res.status(400).json({ error: 'no_org' });

    // ---------------- GET ----------------
    // - /api/lead-note?domains=a.com,b.com  -> { notesByDomain: { "a.com": [...], "b.com": [...] } }
    // - /api/lead-note?company_domain=a.com -> { notes: [...] }
    if (req.method === 'GET') {
      const rawDomains = (req.query.domains || '').toString().trim();
      const singleDomain = (req.query.company_domain || '').toString().trim().toLowerCase();

      if (rawDomains) {
        const domains = rawDomains
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean);

        const { data, error } = await supabaseAdmin
          .from('lead_notes')
          .select('id, company_domain, note, created_at, updated_at')
          .eq('org_id', orgId)
          .in('company_domain', domains)
          .order('updated_at', { ascending: false });

        if (error) throw error;

        const notesByDomain = {};
        for (const n of (data || [])) {
          const d = n.company_domain;
          if (!notesByDomain[d]) notesByDomain[d] = [];
          notesByDomain[d].push(n);
        }
        return res.status(200).json({ notesByDomain });
      }

      if (singleDomain) {
        const { data, error } = await supabaseAdmin
          .from('lead_notes')
          .select('id, company_domain, note, created_at, updated_at')
          .eq('org_id', orgId)
          .eq('company_domain', singleDomain)
          .order('updated_at', { ascending: false });

        if (error) throw error;
        return res.status(200).json({ notes: data || [] });
      }

      // Zonder filter: redelijke limiet
      const { data, error } = await supabaseAdmin
        .from('lead_notes')
        .select('id, company_domain, note, created_at, updated_at')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(1000);

      if (error) throw error;

      const notesByDomain = {};
      for (const n of (data || [])) {
        const d = n.company_domain;
        if (!notesByDomain[d]) notesByDomain[d] = [];
        notesByDomain[d].push(n);
      }
      return res.status(200).json({ notesByDomain });
    }

    // ---------------- POST ----------------
    // Upsert per (org_id, company_domain)
    // Body: { id?, company_domain, content? | note? }
    if (req.method === 'POST') {
      const body = req.body || {};
      const id = body.id ?? null;
      const domain = String(body.company_domain || '').trim().toLowerCase();
      const cleanNote = String(body.note ?? body.content ?? '').trim(); // accepteer beide

      if (!domain || !cleanNote) {
        return res.status(400).json({ error: 'company_domain_and_note_required' });
      }

      if (id) {
        // Gerichte update op id (veiligst)
        const { data, error } = await supabaseAdmin
          .from('lead_notes')
          .update({ note: cleanNote, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('org_id', orgId)
          .select()
          .single();

        if (error) throw error;
        return res.status(200).json({ note: data });
      }

      // UPSERT op (org_id, company_domain)
      const { data, error } = await supabaseAdmin
        .from('lead_notes')
        .upsert(
          {
            org_id: orgId,
            company_domain: domain,
            note: cleanNote,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,company_domain' } // unieke index bestaat al
        )
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ note: data });
    }

    // ---------------- DELETE ----------------
    // Body: { id }  of  { company_domain, deleteAllForDomain: true }
    if (req.method === 'DELETE') {
      const body = req.body || {};
      const id = body.id ?? null;

      if (id) {
        const { error } = await supabaseAdmin
          .from('lead_notes')
          .delete()
          .eq('id', id)
          .eq('org_id', orgId);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      const domain = String(body.company_domain || '').trim().toLowerCase();
      const deleteAll = Boolean(body.deleteAllForDomain);

      if (domain && deleteAll) {
        const { error } = await supabaseAdmin
          .from('lead_notes')
          .delete()
          .eq('org_id', orgId)
          .eq('company_domain', domain);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'id_required_or_company_domain_with_deleteAllForDomain' });
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ error: `method_not_allowed: ${req.method}` });
  } catch (err) {
    console.error('[/api/lead-note] ERROR:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
