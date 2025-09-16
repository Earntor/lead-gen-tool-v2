// pages/api/cron/digest.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient';
import { sendEmail } from '../../../lib/mailer';

const TZ = process.env.DIGEST_TZ || 'Europe/Amsterdam';

function assertSecret(req) {
  const headerSecret = req.headers['x-cron-secret'];
  const querySecret  = req.query?.secret;
  const ok = (headerSecret && headerSecret === process.env.CRON_SECRET)
          || (querySecret  && querySecret  === process.env.CRON_SECRET);
  if (!ok) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

function fmtNL(d) {
  try {
    return new Date(d).toLocaleString('nl-NL', { timeZone: TZ });
  } catch {
    return d;
  }
}

function isMondayInTZ(date = new Date(), timeZone = TZ) {
  const wd = new Intl.DateTimeFormat('nl-NL', { timeZone, weekday: 'short' }).format(date).toLowerCase();
  return wd.startsWith('ma'); // maandag
}

function isFirstOfMonthInTZ(date = new Date(), timeZone = TZ) {
  const day = new Intl.DateTimeFormat('nl-NL', { timeZone, day: 'numeric' }).format(date);
  return day === '1';
}

async function getStrictBounds(frequency) {
  const { data, error } = await supabaseAdmin.rpc('get_digest_bounds', {
    p_frequency: frequency,
    p_tz: TZ
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.period_start_utc || !row?.period_end_utc) {
    throw new Error(`Geen grenzen ontvangen voor ${frequency}`);
  }
  return { start: row.period_start_utc, end: row.period_end_utc };
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
    ? `<p style="margin:16px 0 0 0;">+${leads.length - 10} extra leads in het dashboard.</p>`
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

async function runFrequencyWithBounds(frequency, bounds) {
  const periodStartISO = bounds.start;
  const periodEndISO   = bounds.end;

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

  const results = [];
  if (!subs || subs.length === 0) return { frequency, results, message: 'Geen subscriptions' };

  for (const s of subs) {
    const { user_id, org_id } = s;
    try {
      // E-mailadres
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name')
        .eq('id', user_id)
        .maybeSingle();

      if (profileErr) throw profileErr;
      if (!profile?.email) {
        await supabaseAdmin.from('email_log').insert({
          user_id, org_id, frequency,
          period_start_utc: periodStartISO,
          period_end_utc:   periodEndISO,
          lead_count: 0,
          status: 'error',
          error_msg: 'Geen e-mailadres gevonden voor user'
        });
        results.push({ user_id, org_id, status: 'error', error: 'no email' });
        continue;
      }

      // Leads precies binnen de kalendergrenzen
      const { data: leads, error: leadsErr } = await supabaseAdmin
        .from('leads')
        .select('id, company_name, company_domain, category, confidence, created_at')
        .eq('org_id', org_id)
        .gte('created_at', periodStartISO)
        .lt('created_at',  periodEndISO)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (leadsErr) throw leadsErr;

      if (!leads || leads.length === 0) {
        await supabaseAdmin.from('email_log').insert({
          user_id, org_id, frequency,
          period_start_utc: periodStartISO,
          period_end_utc:   periodEndISO,
          lead_count: 0,
          status: 'skipped_empty',
          error_msg: null
        });
        results.push({ user_id, org_id, status: 'skipped_empty' });
        continue;
      }

      const titleMap = {
        daily:   'Dagelijks leadoverzicht',
        weekly:  'Wekelijks leadoverzicht',
        monthly: 'Maandelijks leadoverzicht'
      };
      const title     = titleMap[frequency];
      const rangeText = `${fmtNL(periodStartISO)} — ${fmtNL(periodEndISO)}`;
      const appUrl    = process.env.APP_URL || '#';

      const html = buildEmailHTML({ title, rangeText, leads, appUrl });

      await sendEmail({
        to: profile.email,
        subject: `${title} • ${rangeText}`,
        html
      });

      await supabaseAdmin.from('email_log').insert({
        user_id, org_id, frequency,
        period_start_utc: periodStartISO,
        period_end_utc:   periodEndISO,
        lead_count: leads.length,
        status: 'sent',
        error_msg: null
      });

      results.push({ user_id, org_id, status: 'sent', leads: leads.length });
    } catch (innerErr) {
      console.error('digest error (per sub):', innerErr);
      await supabaseAdmin.from('email_log').insert({
        user_id: s.user_id,
        org_id: s.org_id,
        frequency,
        period_start_utc: periodStartISO,
        period_end_utc:   periodEndISO,
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

  return { frequency, results };
}

export default async function handler(req, res) {
  try {
    assertSecret(req);

    // Optioneel: forceer specifieke frequentie (?frequency=weekly/monthly) voor tests
    const qf = req.query.frequency;
    const now = new Date();

    const toRun = [];
    // Daily: altijd
    toRun.push('daily');
    // Weekly: alleen op maandag in NL
    if (isMondayInTZ(now, TZ)) toRun.push('weekly');
    // Monthly: alleen op 1e van de maand in NL
    if (isFirstOfMonthInTZ(now, TZ)) toRun.push('monthly');

    // Als query specifiek is: override
    if (['daily','weekly','monthly'].includes(qf)) {
      toRun.length = 0;
      toRun.push(qf);
    }

    const outputs = [];
    for (const freq of toRun) {
      const bounds = await getStrictBounds(freq);
      const out = await runFrequencyWithBounds(freq, bounds);
      outputs.push({ freq, bounds, ...out });
    }

    return res.json({ ok: true, timezone: TZ, results: outputs });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({ ok: false, error: String(e?.message || e) });
  }
}
