// lib/email/sendWelcomeEmail.js
import { Resend } from 'resend';

const resendKey = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'Leadgen <onboarding@resend.dev>';

export async function sendWelcomeEmail({ to, fullName, orgName }) {
  if (!resendKey) {
    console.warn('RESEND_API_KEY ontbreekt – mail overslaan.');
    return { sent: false, skipped: true };
  }
  const resend = new Resend(resendKey);

  const firstName = (fullName || '').trim().split(' ')[0] || '';
  const subject = `Welkom bij Leadgen${orgName ? ` — ${orgName}` : ''}`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <h2 style="margin:0 0 12px">Welkom ${firstName || ''}! 👋</h2>
      <p>Je account is aangemaakt. Ga door in je dashboard om je eerste resultaten te zien.</p>
      <p style="margin:16px 0">
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || ''}/dashboard"
           style="display:inline-block;background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
          Naar je dashboard
        </a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
      <p style="font-size:13px;color:#475569">Hulp nodig met de tracking? Je kunt dit later ook vanuit het dashboard afronden.</p>
    </div>
  `;

  const { data, error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw error;
  return { sent: true, id: data?.id || null };
}
