import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { send as sendEmail } from '../../lib/resend';
import { signSubscribeToken } from '../../lib/subscribe-token';
import { freePackConfirmation } from '../../lib/email-templates';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';
import { sendFreePackLink } from '../../lib/free-pack';

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
    const { data: existing } = await db.from('subscribers')
      .select('email, name, free_pack_token, confirmed_at, unsubscribed_at').eq('email', email).maybeSingle();

    // Already confirmed and still subscribed: they have the pack, so send the
    // files link straight away instead of a second "confirm your email". On
    // 2026-09-17, all 7 sign-ups from the new leave offer were people already
    // on the list (mostly Etsy buyers given the pack on 09-06) who were each
    // asked to confirm again. Same reply either way, so this cannot be used to
    // test which addresses are subscribed.
    if (existing?.confirmed_at && !existing.unsubscribed_at) {
      await sendFreePackLink(db, existing);
      return json({ ok: true });
    }

    // Never overwrite a stored name (or the original source) with a blank.
    if (!existing) {
      const { error } = await db.from('subscribers').insert({ email, name, source: 'free-pack' });
      if (error) throw error;
    } else if (name) {
      await db.from('subscribers').update({ name }).eq('email', email);
    }

    // Anonymous→known bridge: stamp today's visitor hash → email (same hash
    // formula as /api/track) so admin analytics can name today's activity.
    try {
      const crypto = await import('node:crypto');
      const ua = request.headers.get('user-agent') || '';
      const day = new Date().toISOString().slice(0, 10);
      const secret = process.env.ACCOUNT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'trk';
      const vh = crypto.createHash('sha256').update(`${ip}|${ua}|${day}|${secret}`).digest('hex').slice(0, 32);
      await db.from('visitor_identities').upsert({ visitor_hash: vh, email }, { onConflict: 'visitor_hash' });
    } catch { /* best-effort */ }

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
      tags: [{ name: 'kind', value: 'optin' }],   // user-initiated: bypasses the daily-quota gate
    });

    return json({ ok: true });
  } catch (e) {
    console.error('subscribe failed:', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
