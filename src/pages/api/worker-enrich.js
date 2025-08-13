// pages/api/worker-enrich.js
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = { api: { bodyParser: true } };

const BATCH = 50;
const MAX_ATTEMPTS = 5;
const CLEANUP_DAYS = 30;

const BASE_URL =
  process.env.NEXT_PUBLIC_TRACKING_DOMAIN ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }

  // 🔹 0) Opschonen van oude failed_permanent jobs
  try {
    const cutoffDate = new Date(Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error: cleanupErr, count } = await supabaseAdmin
      .from('enrichment_queue')
      .delete({ count: 'exact' })
      .lt('updated_at', cutoffDate)
      .eq('status', 'failed_permanent');

    if (cleanupErr) {
      console.warn('⚠️ Cleanup failed:', cleanupErr.message);
    } else if (count > 0) {
      console.log(`🧹 Cleanup removed ${count} old failed_permanent jobs`);
    }
  } catch (e) {
    console.warn('⚠️ Cleanup exception:', e.message);
  }

  // 🔹 1) Pak pending jobs (alleen die nog onder de poginglimiet zitten)
  const { data: pending, error: selErr } = await supabaseAdmin
    .from('enrichment_queue')
    .select('*')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (selErr) {
    return res.status(500).json({ error: 'select failed', detail: selErr.message });
  }
  if (!pending?.length) {
    return res.status(200).json({ processed: 0 });
  }

  const ids = pending.map((j) => j.id);

  // 🔹 2) Markeer als running (alleen als status nog pending is)
  const nowIso = new Date().toISOString();
  const { data: grabbed, error: runErr } = await supabaseAdmin
    .from('enrichment_queue')
    .update({ status: 'running', updated_at: nowIso })
    .in('id', ids)
    .eq('status', 'pending')
    .select('*');

  if (runErr) {
    return res.status(500).json({ error: 'update running failed', detail: runErr.message });
  }
  if (!grabbed?.length) {
    return res.status(200).json({ processed: 0, grabbed: 0 });
  }

  let ok = 0;
  let fail = 0;

  // 🔹 3) Verwerk jobs één voor één
  for (const job of grabbed) {
    try {
      const p = job.payload && typeof job.payload === 'object' ? job.payload : {};

      const body = {
        ip_address: job.ip_address,
        user_id: job.user_id,
        page_url: job.page_url,
        anon_id: p.anonId ?? null,
        referrer: p.referrer ?? null,
        utm_source: p.utmSource ?? null,
        utm_medium: p.utmMedium ?? null,
        utm_campaign: p.utmCampaign ?? null,
        duration_seconds: p.durationSeconds ?? 0,
        site_id: job.site_id
      };

      const resp = await fetch(`${BASE_URL}/api/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const t = await safeText(resp);
        throw new Error(`lead ${resp.status}: ${t}`);
      }

      await supabaseAdmin
        .from('enrichment_queue')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', job.id);

      ok++;
      await sleep(25); // mini-pauze
    } catch (e) {
      const newAttempts = (job.attempts || 0) + 1;
      await supabaseAdmin
        .from('enrichment_queue')
        .update({
          status: newAttempts >= MAX_ATTEMPTS ? 'failed_permanent' : 'error',
          attempts: newAttempts,
          error_text: String(e?.message || e),
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
      fail++;
    }
  }

  return res.status(200).json({ processed: grabbed.length, ok, fail });
}

async function safeText(resp) {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
 