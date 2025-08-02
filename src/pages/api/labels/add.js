import { supabase } from "@/lib/supabaseClient";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { companyName, label } = req.body;
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { error } = await supabase.from("labels").insert({
    user_id: user.id,
    company_name: companyName,
    label
  });

  if (error) return res.status(500).json({ error: error.message });

  res.status(200).json({ status: "ok" });
}
