import { supabase } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user || userError) {
    return res.status(401).json({ error: "Niet ingelogd" });
  }

  if (req.method === "POST") {
    const { company_domain, note } = req.body;

    const { error } = await supabase
      .from("lead_notes")
      .upsert({
        user_id: user.id,
        company_domain,
        note,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,company_domain" });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  if (req.method === "GET") {
    const { company_domain } = req.query;
    const { data, error } = await supabase
      .from("lead_notes")
      .select("note")
      .eq("user_id", user.id)
      .eq("company_domain", company_domain)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ note: data?.note || "" });
  }

  if (req.method === "DELETE") {
    const { company_domain } = req.body;

    const { error } = await supabase
      .from("lead_notes")
      .delete()
      .eq("user_id", user.id)
      .eq("company_domain", company_domain);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
