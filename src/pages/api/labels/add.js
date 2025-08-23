// src/pages/api/labels/add.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    // Auth'ed client met doorgegeven JWT (werkt onder RLS van de user)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // User check
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'not_authenticated' });
    }

    // Payload
    const { label, color, companyName = null } = req.body || {};
    const cleanLabel = String(label || '').trim();
    const cleanColor = typeof color === 'string' && color.trim() ? color.trim() : null;

    if (!cleanLabel) {
      return res.status(400).json({ error: 'label_required' });
    }

    // Insert -> direct representatie terughalen vanaf primary
    const { data, error } = await supabase
      .from('labels')
      .insert({
        company_name: companyName ?? null, // null = globaal label
        label: cleanLabel,
        color: cleanColor,
        // org_id: via trigger set_org_from_profile() (zoals bij jou ingericht)
      })
      .select('*')
      .single();

    if (error) {
      // Unieke combi (org_id, company_name, label)
      if (error.code === '23505') {
        return res.status(409).json({ error: 'label_already_exists' });
      }
      return res.status(400).json({ error: error.message || 'insert_failed' });
    }

    // Succes: volledige row terug naar frontend
    return res.status(200).json(data);
  } catch (e) {
    console.error('labels/add error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
