// Contact form handler. Forwards the message to jolly@digitalchiselco.com
// via Resend with the visitor's email set as Reply-To so hitting Reply in
// Gmail goes straight to them.

import type { APIRoute } from 'astro';
import { send as sendEmail } from '../../lib/resend';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPS_INBOX = 'jolly@digitalchiselco.com';

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().toLowerCase();
    const subject = String(body.subject || '').trim().slice(0, 160);
    const message = String(body.message || '').trim().slice(0, 5000);
    // Honeypot — bots fill hidden fields; real users don't.
    const honeypot = String(body.website || '').trim();
    if (honeypot) return json({ ok: true }); // silently ack

    if (!name || !email || !EMAIL_RE.test(email) || !message) {
      return json({ error: 'Name, valid email, and message are required.' }, 400);
    }

    const subj = subject ? `[Contact] ${subject}` : `[Contact] Message from ${name}`;
    const html = `
<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#2A1A0E;">
  <h2 style="font-size:18px;color:#5E380A;margin:0 0 14px;">New contact-form message</h2>
  <table style="font-size:14px;border-collapse:collapse;width:100%;">
    <tr><td style="padding:4px 10px 4px 0;color:#666;">From</td><td style="padding:4px 0;"><strong>${esc(name)}</strong> &lt;<a href="mailto:${esc(email)}" style="color:#854F0B;">${esc(email)}</a>&gt;</td></tr>
    ${subject ? `<tr><td style="padding:4px 10px 4px 0;color:#666;">Subject</td><td style="padding:4px 0;">${esc(subject)}</td></tr>` : ''}
  </table>
  <div style="margin:18px 0 0;padding:14px 16px;background:#F5EFE3;border-left:3px solid #854F0B;border-radius:4px;white-space:pre-wrap;font-size:14px;line-height:1.55;">${esc(message)}</div>
  <p style="font-size:12px;color:#888;margin:18px 0 0;">Hitting reply goes directly to ${esc(email)}.</p>
</div>`;
    const text = `New contact-form message

From   : ${name} <${email}>
${subject ? `Subject: ${subject}\n` : ''}
${message}

(Reply goes to ${email}.)`;

    await sendEmail({
      to: OPS_INBOX,
      subject: subj,
      html,
      text,
      replyTo: email,
      idempotencyKey: `contact:${email}:${Date.now().toString(36)}`,
    });

    return json({ ok: true });
  } catch (e) {
    console.error('contact failed:', e);
    return json({ error: 'Something went wrong. Please email jolly@digitalchiselco.com directly.' }, 500);
  }
};
