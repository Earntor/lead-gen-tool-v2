// /pages/api/labels/delete.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Niet ingelogd (geen token)' });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  // Auth user ophalen
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Org bepalen (voor RLS + scoping)
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('current_org_id')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile?.current_org_id) {
    return res.status(400).json({ error: 'Geen organisatie gevonden' });
  }

  // Input valideren
  const { labelId } = req.body || {};
  if (!labelId || typeof labelId !== 'string') {
    return res.status(400).json({ error: 'Geen geldige labelId opgegeven' });
  }

  // Delete: scope op id + org_id (past bij je RLS policies)
  const { data, error } = await supabase
    .from('labels')
    .delete()
    .eq('id', labelId)
    .eq('org_id', profile.current_org_id)
    .select()
    .maybeSingle(); // <-- voorkom error bij 0 rows

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Niks gevonden om te verwijderen (bijv. verkeerde org of labelId)
  if (!data) {
    return res.status(404).json({ error: 'Label niet gevonden of niet van jouw organisatie' });
  }

  return res.status(200).json(data);
}
