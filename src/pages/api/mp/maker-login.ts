// A maker requests a sign-in link to their Cut Local dashboard. Only approved
// makers get one (others are told their application is still under review).
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';
import { send as sendEmail } from '../../../lib/resend';
import { signMakerToken } from '../../../lib/marketplace-token';

export const prerender = false;
const SITE = (import.meta.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!(await rateLimit(`mplogin:ip:${ip}`, 6, 3600))) return tooMany('Too many requests. Please wait a few minutes.');
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400);

  const db = supabaseAdmin();
  const { data: maker } = await db.from('makers').select('id, status, maker_name').eq('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
  // Always reply the same way (don't reveal who's a maker), but only email approved ones.
  if (maker?.status === 'approved') {
    const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(email))}`;
    await sendEmail({
      to: email, subject: 'Your Cut Local maker sign-in link',
      html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;"><p>Hi ${maker.maker_name || ''},</p><p>Here's your sign-in link to the Cut Local maker dashboard:</p><p style="margin:20px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">Open my dashboard →</a></p><p style="font-size:12px;color:#9a8b76;">Valid for 30 days. If you didn't request this, ignore it.</p></div>`,
      text: `Your Cut Local maker dashboard: ${link}`, tags: [{ name: 'kind', value: 'marketplace' }],
    });
  }
  return json({ ok: true, sent: true });
};
