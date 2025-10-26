// /src/pages/api/assignments/history.js
import { supabaseAdmin } from "../../../lib/supabaseAdminClient";

export default async function handler(req, res) {
  try {
    const { company_id, org_id } = req.query;
    if (!company_id || !org_id)
      return res.status(400).json({ error: "company_id en org_id zijn verplicht" });

    const { data, error } = await supabaseAdmin
      .from("lead_assignment_history")
      .select(
        `
        id,
        company_id,
        old_assignee_user_id,
        new_assignee_user_id,
        changed_by_user_id,
        reason,
        changed_at,
        profiles!lead_assignment_history_new_assignee_user_id_fkey (full_name),
        profiles!lead_assignment_history_changed_by_user_id_fkey (full_name)
      `
      )
      .eq("org_id", org_id)
      .eq("company_id", company_id)
      .order("changed_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({ data });
  } catch (err) {
    console.error("GET /assignments/history error:", err);
    return res.status(500).json({ error: err.message });
  }
}
