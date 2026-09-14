// "I cannot find the original e-mail with the download link. Please send again."
//
// That request arrived by hand, repeatedly, because the free pack was delivered
// once by a MailerLite automation and lived nowhere else. This mails a fresh
// signed link to /free/files, to the address on file and only to that address.
//
// The reply is deliberately the same whether or not the address is on the list:
// a different answer would turn this into a way to test which email addresses
// have subscribed.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { send as sendEmail } from '../../lib/resend';
import { signSubscribeToken } from '../../lib/subscribe-token';
import { freePackLink } from '../../lib/email-templates';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SITE = ((process.env.PUBLIC_SITE_URL ?? (import.meta as any).env?.PUBLIC_SITE_URL) || 'https://digitalchiselco.com').replace(/\/$/, '');
const SAME_ANSWER = 'If that address is on our list, your download link is on its way. Check your inbox (and your spam folder).';

export const POST: APIRoute = async ({ request }) => {
  const email = String((await request.json().catch(() => ({} as any))).email || '').toLowerCase().trim();
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);

  const ip = clientIp(request);
  if (!(await rateLimit(`free-resend:ip:${ip}`, 10, 3600)) || !(await rateLimit(`free-resend:email:${email}`, 4, 3600))) {
    return tooMany('Too many requests. Please try again a little later.');
  }

  try {
    const db = supabaseAdmin();
    const { data: sub } = await db.from('subscribers').select('email, name').eq('email', email).maybeSingle();
    if (sub) {
      const { data: gs } = await db.from('growth_settings').select('free_pack_url').eq('id', 1).maybeSingle();
      const url = `${SITE}/free/files?token=${encodeURIComponent(signSubscribeToken(email))}`;
      const { subject, html, text } = freePackLink({ name: sub.name, filesUrl: url, packUrl: gs?.free_pack_url || '' });
      await sendEmail({
        to: email, subject, html, text,
        // Timestamped: unlike the one-off confirmation, asking twice must
        // actually send twice, which is the whole point of the button.
        idempotencyKey: `free-resend:${email}:${Date.now()}`,
        tags: [{ name: 'kind', value: 'optin' }],   // user-initiated: bypasses the daily-quota gate
      });
    }
    return json({ ok: true, message: SAME_ANSWER });
  } catch (e) {
    console.error('[free-resend]', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};
