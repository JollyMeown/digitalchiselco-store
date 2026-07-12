import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { send as sendEmail } from '../../lib/resend';
import { signSubscribeToken } from '../../lib/subscribe-token';
import { freePackConfirmation } from '../../lib/email-templates';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

const SITE = (env('PUBLIC_SITE_URL') || 'https://digitalchiselco.com').replace(/\/$/, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    const name = String(body.name || '').trim().slice(0, 120) || null;
    if (!EMAIL_RE.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }

    const ip = clientIp(request);
    if (!(await rateLimit(`subscribe:ip:${ip}`, 10, 3600)) ||
        !(await rateLimit(`subscribe:email:${email}`, 4, 3600))) {
      return tooMany();
    }

    // Always upsert into our subscribers table. confirmed_at stays null until
    // the user clicks the link in the email.
    const db = supabaseAdmin();
    const { error } = await db
      .from('subscribers')
      .upsert({ email, name, source: 'free-pack' }, { onConflict: 'email' });
    if (error) throw error;

    // Send our own confirmation email via Resend. We deliberately DO NOT
    // call MailerLite here — that happens after the click, in
    // /free/confirm, so the welcome automation only fires for real humans.
    const token = signSubscribeToken(email);
    const confirmUrl = `${SITE}/free/confirm?token=${encodeURIComponent(token)}`;
    const { subject, html, text } = freePackConfirmation({ email, name, confirmUrl });
    await sendEmail({
      to: email,
      subject,
      html,
      text,
      idempotencyKey: `subscribe-confirm:${email}`,
    });

    return json({ ok: true });
  } catch (e) {
    console.error('subscribe failed:', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
