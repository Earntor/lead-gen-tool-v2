import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { projectId } = req.query;

  if (!projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("last_tracking_ping")
    .eq("id", projectId)
    .single();

  if (error) {
    console.error("Supabase error:", error);
    return res.status(500).json({ error: error.message });
  }

  if (!data.last_tracking_ping) {
    return res.status(200).json({ status: "not_found" });
  }

  const lastPing = new Date(data.last_tracking_ping);
  const diffMinutes = (Date.now() - lastPing.getTime()) / 60000;

  if (diffMinutes < 5) {
    return res.status(200).json({ status: "ok" });
  } else {
    return res.status(200).json({ status: "stale" });
  }
}
