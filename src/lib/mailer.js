// lib/mailer.js
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Kleine helper: kies afzender volgorde (DIGEST_FROM > EMAIL_FROM > fallback)
function getFrom() {
  return (
    process.env.DIGEST_FROM ||
    process.env.EMAIL_FROM ||
    'Lead Digest <noreply@example.com>'
  );
}

/**
 * Stuur een e-mail via Resend.
 * @param {Object} opts
 * @param {string|string[]} opts.to - ontvanger(s)
 * @param {string} opts.subject
 * @param {string} opts.html
 */
export async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY ontbreekt als env var');
  }
  const from = getFrom();

  const result = await resend.emails.send({ from, to, subject, html });

  if (result?.error) {
    throw new Error(result.error?.message || 'Onbekende Resend-fout');
  }
  return result;
}
