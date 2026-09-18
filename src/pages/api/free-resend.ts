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
import { sendFreePackLink } from '../../lib/free-pack';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
    const { data: sub } = await db.from('subscribers').select('email, name, free_pack_token').eq('email', email).maybeSingle();
    if (sub) await sendFreePackLink(db, sub);
    return json({ ok: true, message: SAME_ANSWER });
  } catch (e) {
    console.error('[free-resend]', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};
