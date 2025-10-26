// src/pages/api/assignments/index.js
import { supabaseAdmin } from "../../../lib/supabaseAdminClient";
import { Resend } from "resend";

// ===================== Email setup =====================
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const FROM_EMAIL = process.env.ASSIGN_FROM_EMAIL || "Leadetect <noreply@example.com>";

// ===================== Helpers =========================
function parseUUID(val) {
  if (!val) return null;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return re.test(val) ? val : null;
}

async function getCompanyMeta(org_id, company_id) {
  // 1) companies (naam + primary_domain)
  const { data: comp, error: compErr } = await supabaseAdmin
    .from("companies")
    .select("name, primary_domain")
    .eq("org_id", org_id)
    .eq("company_id", company_id)
    .maybeSingle();

  let name = comp?.name || null;
  let domain = comp?.primary_domain || null;

  // 2) Fallback: 1 domein uit company_domains
  if (!domain) {
    const { data: cd } = await supabaseAdmin
      .from("company_domains")
      .select("domain")
      .eq("org_id", org_id)
      .eq("company_id", company_id)
      .limit(1)
      .maybeSingle();
    domain = cd?.domain || null;
  }

  return { name, domain };
}


async function sendAssignmentEmail({ to, assigneeName, byName, companyName, companyDomain, message }) {
  if (!to) return;
  if (!resend) {
    console.warn("[assignments] RESEND_API_KEY ontbreekt — e-mail wordt overgeslagen.");
    return;
  }

  const subject = `Nieuwe lead toegewezen: ${companyName || companyDomain || "Lead"}`;
  const leadLink = companyDomain ? `${APP_URL}/dashboard?company=${encodeURIComponent(companyDomain)}` : `${APP_URL}/dashboard`;

  const textLines = [
    `Hoi ${assigneeName || ""},`,
    "",
    `Je hebt een lead toegewezen gekregen${byName ? ` door ${byName}` : ""}.`,
    `Bedrijf: ${companyName || companyDomain || "-"}`,
    companyDomain ? `Domein: ${companyDomain}` : "",
    message ? "" : null,
    message ? "Bericht van collega:" : null,
    message ? message : null,
    "",
    `Open de lead: ${leadLink}`,
  ].filter(Boolean);

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#111">
      <p>Hoi ${assigneeName || ""},</p>
      <p>Je hebt een lead toegewezen gekregen${byName ? ` door <strong>${byName}</strong>` : ""}.</p>
      <p><strong>Bedrijf:</strong> ${companyName || companyDomain || "-"}</p>
      ${companyDomain ? `<p><strong>Domein:</strong> ${companyDomain}</p>` : ""}
      ${message ? `<p><strong>Bericht van collega:</strong><br>${String(message).replace(/\n/g, "<br>")}</p>` : ""}
      <p>
        <a href="${leadLink}" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;">
          Open lead
        </a>
      </p>
    </div>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    text: textLines.join("\n"),
    html,
  });
}

// ===================== Handler =========================
export default async function handler(req, res) {
  const { method } = req;

  // 1) GET — lijst huidige toewijzingen (optioneel gefilterd)
  if (method === "GET") {
    try {
      const { org_id, assignee_user_id } = req.query;

      const query = supabaseAdmin
        .from("lead_assignments")
        .select(
          `
          id,
          org_id,
          company_id,
          assignee_user_id,
          assigned_by_user_id,
          assigned_at,
          companies ( name, primary_domain )
        `
        )
        .order("assigned_at", { ascending: false });

      if (org_id) query.eq("org_id", org_id);
      if (assignee_user_id) query.eq("assignee_user_id", assignee_user_id);

      const { data, error } = await query;
      if (error) throw error;

      return res.status(200).json({ data });
    } catch (err) {
      console.error("GET /assignments error:", err);
      return res.status(500).json({ error: err.message || "Serverfout" });
    }
  }

  // 2) POST — toewijzen / unassign + e-mail (met persoonlijk bericht)
  if (method === "POST") {
    try {
      const {
        org_id,
        company_id,
        assignee_user_id,       // null/"" = unassign
        assigned_by_user_id,
        reason,
        message,                // ✨ persoonlijk bericht
      } = req.body || {};

      const orgId = parseUUID(org_id);
      const companyId = parseUUID(company_id);
      const assigneeId = assignee_user_id ? parseUUID(assignee_user_id) : null;
      const byUserId = assigned_by_user_id ? parseUUID(assigned_by_user_id) : null;

      if (!orgId || !companyId) {
        return res.status(400).json({ error: "Ongeldige org_id of company_id" });
      }

      const now = new Date().toISOString();

      // Huidige assignment (mag ontbreken)
      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("lead_assignments")
        .select("*")
        .eq("org_id", orgId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (existingErr && existingErr.code && existingErr.code !== "PGRST116") {
        // PGRST116 = No rows
        throw existingErr;
      }

      // === UNASSIGN ===
      if (!assigneeId) {
        if (existing) {
          await supabaseAdmin.from("lead_assignments").delete().eq("id", existing.id);
          await supabaseAdmin.from("lead_assignment_history").insert({
            org_id: orgId,
            company_id: companyId,
            old_assignee_user_id: existing.assignee_user_id,
            new_assignee_user_id: null,
            changed_by_user_id: byUserId,
            reason: reason || "unassign",
            changed_at: now,
          });
        }
        return res.status(200).json({ message: "Lead unassigned" });
      }

      // === UPSERT (assign/reassign) ===
      const { error: upsertErr } = await supabaseAdmin
        .from("lead_assignments")
        .upsert(
          {
            org_id: orgId,
            company_id: companyId,
            assignee_user_id: assigneeId,
            assigned_by_user_id: byUserId,
            assigned_at: now,
          },
          { onConflict: "org_id,company_id" }
        );
      if (upsertErr) throw upsertErr;

      // History log
      await supabaseAdmin.from("lead_assignment_history").insert({
        org_id: orgId,
        company_id: companyId,
        old_assignee_user_id: existing ? existing.assignee_user_id : null,
        new_assignee_user_id: assigneeId,
        changed_by_user_id: byUserId,
        reason: reason || (existing ? "reassign" : "manual"),
        changed_at: now,
        // Als je een kolom `message` in history hebt, kun je 'm hier ook opslaan:
        // message: message || null,
      });

      // === E-mail notificatie ===
      // Alleen bij toewijzen (niet bij unassign)
      // Haal assignee + afzender + bedrijf info op
      const [{ data: assignee }, { data: byUser }, meta] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("full_name, email")
          .eq("id", assigneeId)
          .maybeSingle(),
        byUserId
          ? supabaseAdmin
              .from("profiles")
              .select("full_name")
              .eq("id", byUserId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        getCompanyMeta(orgId, companyId),
      ]);

      if (assignee?.email) {
        await sendAssignmentEmail({
          to: assignee.email,
          assigneeName: assignee.full_name || "",
          byName: byUser?.full_name || "",
          companyName: meta?.name || "",
          companyDomain: meta?.domain || "",
          message: typeof message === "string" ? message.trim() : "",
        });
      }

      return res.status(200).json({ message: "Lead toegewezen" });
    } catch (err) {
      console.error("POST /assignments error:", err);
      return res.status(500).json({ error: err.message || "Serverfout" });
    }
  }

  // 3) Overige methoden
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${method} Not Allowed`);
}
