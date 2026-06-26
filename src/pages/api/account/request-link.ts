import type { APIRoute } from 'astro';
import { signAccountToken } from '../../../lib/account-token';
import { send } from '../../../lib/resend';

export const prerender = false;

const SITE = process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  let email = '';
  try {
    const body = await request.json();
    email = String(body?.email || '').trim().toLowerCase();
  } catch {
    /* fall through to validation */
  }
  if (!email || !EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: 'Please enter a valid email.' }, { status: 400 });
  }

  const token = signAccountToken(email);
  const link = `${SITE}/account?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2A1A0E;background:#fff;">
      <h1 style="font-size:20px;color:#5E380A;margin:0 0 12px;">Sign in to your DigitalChiselCo account</h1>
      <p style="line-height:1.55;margin:0 0 18px;">
        Click the button below to view your past orders and re-download your STL files.
      </p>
      <p style="margin:24px 0;">
        <a href="${link}" style="display:inline-block;background:#854F0B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:500;">View my account</a>
      </p>
      <p style="font-size:13px;color:#666;line-height:1.5;">
        Or paste this link into your browser:<br>
        <span style="word-break:break-all;">${link}</span>
      </p>
      <p style="font-size:13px;color:#666;margin-top:20px;">
        This link is valid for 30 days. If you didn't request this, you can safely ignore this email.
      </p>
    </div>`;
  const text = `Sign in to your DigitalChiselCo account: ${link}\n\nValid for 30 days. If you didn't request this, ignore this email.`;

  await send({
    to: email,
    subject: 'Sign in to your DigitalChiselCo account',
    html,
    text,
  });

  return Response.json({ ok: true });
};
