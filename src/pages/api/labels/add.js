// /pages/api/labels/add.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Niet ingelogd (geen token)' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  // 1) Auth user
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // 2) Bepaal org
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('current_org_id')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile?.current_org_id) {
    return res.status(400).json({ error: 'Geen organisatie gevonden' });
  }

  // 3) Body en validatie
  let { companyName, label, color } = req.body || {};
  const cleanLabel = (label || '').trim();
  if (!cleanLabel) {
    return res.status(400).json({ error: 'Label ontbreekt' });
  }

  // companyName mag null zijn voor globale labels
  const cleanCompanyName =
    companyName == null ? null : String(companyName).trim() || null;

  // 4) Insert
  const { data, error } = await supabase
    .from('labels')
    .insert({
      org_id: profile.current_org_id,
      company_name: cleanCompanyName,  // kan null zijn
      label: cleanLabel,
      color: color || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data);
}
