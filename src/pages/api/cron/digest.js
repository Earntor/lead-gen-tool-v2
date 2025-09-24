// pages/api/cron/digest.js
import { supabaseAdmin } from '../../../lib/supabaseAdminClient';
import { sendEmail, __mailInternals } from '../../../lib/mailer';

const TZ = process.env.DIGEST_TZ || 'Europe/Amsterdam';

function assertSecret(req) {
  const auth = req.headers['authorization'];
  const querySecret = req.query?.secret;
  const want = process.env.CRON_SECRET;

  const ok =
    (auth && want && auth === `Bearer ${want}`) || // Vercel Cron (automatisch)
    (querySecret && want && querySecret === want); // handmatige test ?secret=...

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

// --------------------- SUBJECT HELPERS ---------------------
function getLocalYMD(iso, timeZone) {
  // Haal Y-M-D op in de gewenste timezone en maak er een "datum zonder tijdzone" van
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('nl-NL', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const y = Number(parts.year), m = Number(parts.month), day = Number(parts.day);
  // Gebruik UTC om tijdzone-ruis te voorkomen (we rekenen alleen met datum)
  return new Date(Date.UTC(y, m - 1, day));
}

function isoWeekNumber(dateUTC) {
  // dateUTC is een Date op middernacht UTC van de lokale datum
  const tmp = new Date(Date.UTC(
    dateUTC.getUTCFullYear(), dateUTC.getUTCMonth(), dateUTC.getUTCDate()
  ));
  // Donderdag is in week 1 volgens ISO-8601
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function monthNameNL(iso, timeZone) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone, month: 'long' })
    .format(new Date(iso))
    .toLowerCase();
}

function weekdayNameNL(iso, timeZone) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone, weekday: 'long' })
    .format(new Date(iso))
    .toLowerCase();
}

function dayOfMonthNL(iso, timeZone) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone, day: 'numeric' })
    .format(new Date(iso));
}

function buildSubject(frequency, count, periodStartISO, timeZone) {
  if (frequency === 'daily') {
    // {aantal} bezoekers op {maandag} {23} {september}
    const wd = weekdayNameNL(periodStartISO, timeZone);      // maandag
    const day = dayOfMonthNL(periodStartISO, timeZone);      // 23
    const mon = monthNameNL(periodStartISO, timeZone);       // september
    return `${count} bezoekers op ${wd} ${day} ${mon}`;
  }
  if (frequency === 'weekly') {
    // {aantal} bezoekers in week {weeknummer}
    const localYMD = getLocalYMD(periodStartISO, timeZone);
    const wk = isoWeekNumber(localYMD);
    return `${count} bezoekers in week ${wk}`;
  }
  if (frequency === 'monthly') {
    // {aantal} bezoekers in {maand}
    const mon = monthNameNL(periodStartISO, timeZone);
    return `${count} bezoekers in ${mon}`;
  }
  // fallback (zou niet moeten gebeuren)
  return `${count} bezoekers`;
}
// ------------------- EINDE SUBJECT HELPERS -------------------

// --------------------- PERIODE-LABEL HELPER ---------------------
function buildPeriodLabel(frequency, periodStartISO, timeZone) {
  const src = new Date(periodStartISO);

  if (frequency === 'daily') {
    const wd = new Intl.DateTimeFormat('nl-NL', { timeZone, weekday: 'long' })
      .format(src).toLowerCase();          // maandag
    const day = new Intl.DateTimeFormat('nl-NL', { timeZone, day: 'numeric' })
      .format(src);                         // 22
    const mon = new Intl.DateTimeFormat('nl-NL', { timeZone, month: 'long' })
      .format(src).toLowerCase();          // september
    return `${wd} ${day} ${mon}`;
  }

  if (frequency === 'weekly') {
    // Pak de lokale datum (Y-M-D) in gewenste TZ om correcte ISO-week te krijgen
    const parts = new Intl.DateTimeFormat('nl-NL', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(src).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
    const localUTC = new Date(Date.UTC(y, m - 1, d));

    // ISO weeknummer (week met eerste donderdag is week 1)
    const tmp = new Date(Date.UTC(localUTC.getUTCFullYear(), localUTC.getUTCMonth(), localUTC.getUTCDate()));
    const dayOfWeek = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayOfWeek);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);

    return `week ${weekNo}`;
  }

  if (frequency === 'monthly') {
    const mon = new Intl.DateTimeFormat('nl-NL', { timeZone, month: 'long' })
      .format(src).toLowerCase();          // augustus
    return mon;
  }

  // fallback
  return '';
}
// ------------------- EINDE PERIODE-LABEL HELPER -------------------


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

function buildEmailHTML({ title, periodLabel, leads, appUrl }) {
  const rows = (leads || []).slice(0, 10).map(l => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">
        ${l.company_name ?? '(onbekend)'}
        <br><small>${l.company_domain ?? ''}</small>
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${l.category ?? ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${typeof l.confidence === 'number' ? l.confidence.toFixed(2) : (l.confidence ?? '')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${fmtNL(l.created_at)}</td>
    </tr>
  `).join('');

  const moreNote = (leads && leads.length > 10)
    ? `<p style="margin:16px 0 0 0;">+${leads.length - 10} extra leads in het dashboard.</p>`
    : '';

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;">
      <h1 style="margin:0 0 8px 0;">${title}</h1>
      <p style="margin:0 0 16px 0;color:#555;">Periode: ${periodLabel}</p>
      <p style="margin:0 0 16px 0;">Totaal nieuwe leads: <strong>${leads?.length || 0}</strong></p>

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
    let recipientEmail = null;

    try {
      // 1) E-mailadres van de ontvanger
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name')
        .eq('id', user_id)
        .maybeSingle();
      if (profileErr) throw profileErr;

      recipientEmail = profile?.email ?? null;
      if (!recipientEmail) {
        await supabaseAdmin.from('email_log').insert({
          user_id, org_id, frequency,
          period_start_utc: periodStartISO,
          period_end_utc:   periodEndISO,
          lead_count: 0,
          status: 'error',
          error_msg: 'Geen e-mailadres gevonden voor user',
          recipient_email: null,
          resend_id: null
        });
        results.push({ user_id, org_id, status: 'error', error: 'no email' });
        continue;
      }

      // 2) Leads in de periode
      const { data: leads, error: leadsErr } = await supabaseAdmin
        .from('leads')
        .select('id, company_name, company_domain, category, confidence, created_at')
        .eq('org_id', org_id)
        .gte('created_at', periodStartISO)
        .lt('created_at',  periodEndISO)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (leadsErr) throw leadsErr;

      // 3) Mail voorbereiden
      const titleMap = {
        daily:   'Dagelijks bezoekersoverzicht',
        weekly:  'Wekelijks bezoekersoverzicht',
        monthly: 'Maandelijks bezoekersoverzicht'
      };
      const title     = titleMap[frequency];
      const rangeText = `${fmtNL(periodStartISO)} — ${fmtNL(periodEndISO)}`;
      const appUrl    = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '#';
      const allowed   = __mailInternals.isAllowedRecipient(recipientEmail);
      const isFree    = (process.env.RESEND_PLAN || '').toLowerCase() === 'free';
      const periodLabel = buildPeriodLabel(frequency, periodStartISO, TZ);


      // ✉️ Nieuw subject op basis van frequentie + aantal leads
const subject = buildSubject(frequency, (leads?.length || 0), periodStartISO, TZ);


     // ⚠️ Bij 0 leads: niet mailen, alleen loggen
if (!leads || leads.length === 0) {
  await supabaseAdmin.from('email_log').insert({
    user_id, org_id, frequency,
    period_start_utc: periodStartISO,
    period_end_utc:   periodEndISO,
    lead_count: 0,
    status: 'skipped_empty',
    error_msg: null,
    recipient_email: recipientEmail,
    resend_id: null
  });

  results.push({ user_id, org_id, status: 'skipped_empty', leads: 0 });
  continue; // ga door met volgende subscription
}


      // 5) Wel leads → mailen of blokkeren (Free)
const html = buildEmailHTML({ title, periodLabel, leads, appUrl });

      if (!allowed && isFree) {
        await supabaseAdmin.from('email_log').insert({
          user_id, org_id, frequency,
          period_start_utc: periodStartISO,
          period_end_utc:   periodEndISO,
          lead_count: leads.length,
          status: 'blocked_free_plan',
          error_msg: `Free plan allows only ${process.env.RESEND_ALLOWED_TO || '(unset)'}`,
          recipient_email: recipientEmail,
          resend_id: null
        });
        results.push({ user_id, org_id, status: 'blocked_free_plan' });
      } else {
       const sent = await sendEmail({
  to: recipientEmail,
  subject, // nieuw dynamisch subject
  html
});


        await supabaseAdmin.from('email_log').insert({
          user_id, org_id, frequency,
          period_start_utc: periodStartISO,
          period_end_utc:   periodEndISO,
          lead_count: leads.length,
          status: 'sent',
          error_msg: null,
          recipient_email: recipientEmail,
          resend_id: sent?.id || null
        });

        results.push({ user_id, org_id, status: 'sent', leads: leads.length });
      }
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
        error_msg: String(innerErr?.message || innerErr),
        recipient_email: recipientEmail,
        resend_id: null
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

    const qf = (req.query.frequency || '').toLowerCase();
    const now = new Date();

    const toRun = [];
    toRun.push('daily');                       // daily altijd
    if (isMondayInTZ(now, TZ)) toRun.push('weekly');       // weekly op maandag (NL)
    if (isFirstOfMonthInTZ(now, TZ)) toRun.push('monthly'); // monthly op 1e (NL)

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
