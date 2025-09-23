// lib/mailer.js
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function getFrom() {
  return (
    process.env.RESEND_FROM ||                 // straks je geverifieerde domein
    process.env.DIGEST_FROM ||                 // jouw huidige env-naam
    process.env.EMAIL_FROM ||                  // evt. oudere naam
    'Lead Digest <onboarding@resend.dev>'      // fallback bouwfase
  );
}

// Is ontvanger toegestaan in huidige modus?
function isAllowedRecipient(email) {
  const plan = (process.env.RESEND_PLAN || '').toLowerCase();
  if (plan !== 'free') return true; // verified/pro: alles mag
  const allowed = (process.env.RESEND_ALLOWED_TO || '').toLowerCase().trim();
  return allowed && (email || '').toLowerCase().trim() === allowed;
}

/**
 * Stuur e-mail via Resend
 * @param {Object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]
 * @returns {Promise<{id?: string|null}>}
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY ontbreekt');
  const from = getFrom();
  const toArr = (Array.isArray(to) ? to : [to]).filter(Boolean);

  // Free-plan: filter alle niet-toegestane ontvangers weg
  const filteredTo = toArr.filter(isAllowedRecipient);
  if (filteredTo.length === 0) {
    return { id: null }; // niets verstuurd; caller logt 'blocked_free_plan'
  }

  const res = await resend.emails.send({
    from,
    to: filteredTo,
    subject,
    html,
    text: text || (html ? html.replace(/<[^>]+>/g, ' ') : '')
  });

  if (res?.error) {
    throw new Error(res.error?.message || 'Resend error');
  }
  return res?.data || { id: null };
}

export const __mailInternals = { isAllowedRecipient };
