// Checkout exit-save: the buyer reached payment but is backing out. One click
// emails them their cart with a resume link, so the sale survives the tab.
// Rate-limited; one save-email per address per day; respects unsubscribes.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { send as sendEmail } from '../../lib/resend';
import { cartReminderEmail } from '../../lib/marketing-emails';
import { rateLimit, clientIp } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`cartsave:ip:${clientIp(request)}`, 6, 3600))) return json({ ok: false }, 200);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Valid email required.' }, 400);

    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map((x: any) => ({
      title: String(x.title || '').slice(0, 160),
      price: Number(x.price) || 0,
    })).filter((x: any) => x.title);
    if (!items.length) return json({ error: 'Cart is empty.' }, 400);
    const subtotal = items.reduce((s: number, x: any) => s + x.price, 0);

    const db = supabaseAdmin();
    const { data: sub } = await db.from('subscribers').select('unsubscribed_at').ilike('email', email).maybeSingle();
    if (sub?.unsubscribed_at) return json({ ok: true, message: 'Saved.' });   // don't email, don't reveal

    const { subject, html, text } = cartReminderEmail({ email, items, subtotal });
    await sendEmail({
      to: email,
      subject: 'Your cart is saved, finish whenever you like',
      html, text,
      idempotencyKey: `cartsave:${email}:${new Date().toISOString().slice(0, 10)}`,
      tags: [{ name: 'kind', value: 'cartSave' }],
    });
    return json({ ok: true, message: 'Sent! Check your inbox, your cart link is inside.' });
  } catch {
    return json({ error: 'Could not send right now.' }, 500);
  }
};
