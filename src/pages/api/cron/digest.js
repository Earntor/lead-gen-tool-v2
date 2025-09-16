// pages/api/cron/digest.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient';
import { sendEmail } from '../../../lib/mailer';

// ====== HULPFUNCTIES ======

const PERIOD_DAYS = {
  daily: 1,
  weekly: 7,
  monthly: 30, // pragmatisch
};

function assertSecret(req) {
  const headerSecret = req.headers['x-cron-secret'];
  const querySecret = req.query?.secret;
  const ok = (headerSecret && headerSecret === process.env.CRON_SECRET) ||
             (querySecret && querySecret === process.env.CRON_SECRET);
  if (!ok) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

// Pretty date voor in e-mail (NL, Amsterdam)
function fmtNL(d) {
  try {
    return new Date(d).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' });
  } catch {
    return d;
  }
}

// Ophalen laatste verstuurde (of poging) zodat we een doorlopende periode pakken
async function getPreviousPeriodEnd({ user_id, org_id, frequency }) {
  const { data, error } = await supabaseAdmin
    .from('email_log')
    .select('period_end_utc')
    .eq('user_id', user_id)
    .eq('org_id', org_id)
    .eq('frequency', frequency)
    .order('period_end_utc', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Niet hard crashen; we vallen terug op default periode
    console.error('email_log lookup error:', error.message);
    return null;
  }
  return data?.period_end_utc || null;
}

function getFallbackStartISO(frequency) {
  const now = new Date();
  const d = new Date(now);
  if (frequency === 'daily') d.setUTCDate(d.getUTCDate() - PERIOD_DAYS.daily);
  else if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() - PERIOD_DAYS.weekly);
  else d.setUTCDate(d.getUTCDate() - PERIOD_DAYS.monthly);
  return d.toISOString();
}

function buildEmailHTML({ title, rangeText, leads, appUrl }) {
  const rows = leads.slice(0, 10).map(l => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">
        ${l.company_name ?? '(onbekend)'}
        <br><small>${l.company_domain ?? ''}</small>
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${l.category ?? ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${typeof l.confidence === 'number' ? l.confidence.toFixed(2) : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${fmtNL(l.created_at)}</td>
    </tr>
  `).join('');

  const moreNote = leads.length > 10
    ? `<p style="margin:16px 0 0 0;">+${leads.length -10} extra leads in het dashboard.</p>`
    : '';

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;">
      <h1 style="margin:0 0 8px 0;">${title}</h1>
      <p style="margin:0 0 16px 0;color:#555;">Periode: ${rangeText}</p>
      <p style="margin:0 0 16px 0;">Totaal nieuwe leads: <strong>${leads.length}</strong></p>

      <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
        <thead>
          <tr>
            <th align="left" style="padding:8px;border-bottom:2px solid #ddd;">Bedrijf</th>
            <th align="left" style="padding:8px;border-bottom:2px solid #ddd;">Categorie</th>
            <th align="left" style="padding:8px;border-bottom:2px solid #ddd;">Confidence</th>
            <th align="left" style="padding:8px;border-bottom:2px solid #ddd;">Binnengekomen</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${moreNote}
      <p style="margin:24px 0 0 0;">
        <a href="${appUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">
          Open dashboard
        </a>
      </p>
      <p style="margin:16px 0 0 0;color:#888;font-size:12px;">
        Je ontvangt deze mail omdat digest-emails actief zijn voor jouw organisatie.
      </p>
    </div>
  `;
}

// ====== HANDLER ======

export default async function handler(req, res) {
  try {
    assertSecret(req);

    const frequency = ['daily', 'weekly', 'monthly'].includes(req.query.frequency)
      ? req.query.frequency
      : 'daily';

    const now = new Date();
    const periodEndISO = now.toISOString();

    // 1) Alle subscriptions ophalen waar deze frequentie "enabled" is
    const freqColumn = {
      daily: 'daily_enabled',
      weekly: 'weekly_enabled',
      monthly: 'monthly_enabled',
    }[frequency];

    const { data: subs, error: subsErr } = await supabaseAdmin
      .from('digest_subscriptions')
      .select('user_id, org_id')
      .eq(freqColumn, true);

    if (subsErr) throw subsErr;

    if (!subs || subs.length === 0) {
      return res.json({ ok: true, frequency, results: [], message: 'Geen subscriptions' });
    }

    const results = [];

    // 2) Voor elke subscription: bepaal periode -> haal leads -> mail -> log
    for (const s of subs) {
      const { user_id, org_id } = s;

      try {
        // 2a) Haal e-mailadres op van de gebruiker
        const { data: profile, error: profileErr } = await supabaseAdmin
          .from('profiles')
          .select('email, full_name')
          .eq('id', user_id)
          .maybeSingle();

        if (profileErr) throw profileErr;
        if (!profile?.email) {
          // Zonder e-mail geen verzending
          await supabaseAdmin.from('email_log').insert({
            user_id, org_id, frequency,
            period_start_utc: periodEndISO, // arbitrair, we loggen "skipped"
            period_end_utc: periodEndISO,
            lead_count: 0,
            status: 'error',
            error_msg: 'Geen e-mailadres gevonden voor user'
          });
          results.push({ user_id, org_id, status: 'error', error: 'no email' });
          continue;
        }

        // 2b) Bepaal de periode
        const lastEnd = await getPreviousPeriodEnd({ user_id, org_id, frequency });
        const periodStartISO = lastEnd || getFallbackStartISO(frequency);

        // 2c) Leads ophalen
        const { data: leads, error: leadsErr } = await supabaseAdmin
          .from('leads')
          .select('id, company_name, company_domain, category, confidence, created_at')
          .eq('org_id', org_id)
          .gte('created_at', periodStartISO)
          .lt('created_at', periodEndISO)
          .order('created_at', { ascending: false })
          .limit(1000);

        if (leadsErr) throw leadsErr;

        // 2d) Als leeg -> log "skipped_empty"
        if (!leads || leads.length === 0) {
          await supabaseAdmin.from('email_log').insert({
            user_id, org_id, frequency,
            period_start_utc: periodStartISO,
            period_end_utc: periodEndISO,
            lead_count: 0,
            status: 'skipped_empty',
            error_msg: null
          });
          results.push({ user_id, org_id, status: 'skipped_empty' });
          continue;
        }

        // 2e) E-mail opbouwen + verzenden
        const titleMap = { daily: 'Dagelijks leadoverzicht', weekly: 'Wekelijks leadoverzicht', monthly: 'Maandelijks leadoverzicht' };
        const title = titleMap[frequency];
        const rangeText = `${fmtNL(periodStartISO)} — ${fmtNL(periodEndISO)}`;
        const appUrl = process.env.APP_URL || '#';

        const html = buildEmailHTML({ title, rangeText, leads, appUrl });

        await sendEmail({
          to: profile.email,
          subject: `${title} • ${rangeText}`,
          html
        });

        // 2f) Loggen
        await supabaseAdmin.from('email_log').insert({
          user_id, org_id, frequency,
          period_start_utc: periodStartISO,
          period_end_utc: periodEndISO,
          lead_count: leads.length,
          status: 'sent',
          error_msg: null
        });

        results.push({ user_id, org_id, status: 'sent', leads: leads.length });
      } catch (innerErr) {
        console.error('digest error (per sub):', innerErr);

        // Fout loggen, maar de batch gaat door
        await supabaseAdmin.from('email_log').insert({
          user_id: s.user_id,
          org_id: s.org_id,
          frequency,
          period_start_utc: periodEndISO, // arbitrair als er geen echte periode is
          period_end_utc: periodEndISO,
          lead_count: 0,
          status: 'error',
          error_msg: String(innerErr?.message || innerErr)
        });

        results.push({
          user_id: s.user_id,
          org_id: s.org_id,
          status: 'error',
          error: String(innerErr?.message || innerErr)
        });
      }
    }

    return res.json({ ok: true, frequency, results });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({ ok: false, error: String(e?.message || e) });
  }
}
