// Records a "favorite" as an interest signal so it feeds product affinity,
// personalization, wishlist reminders and price-drop alerts. Only fires when
// the visitor's email is known (logged in / subscribed). Anonymous favorites
// live in localStorage only.
//
// Hardened (2026-08-17 audit): rate-limited per IP, product_id must be a real
// active product, and the email must already be KNOWN to us (a subscriber or a
// past buyer). Previously any address on earth could be planted here and the
// wishlist-reminder automation would then email it — an unsolicited-mail hole.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`favorite:ip:${clientIp(request)}`, 60, 3600))) return json({ ok: false }, 200);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    const productId = String(body.product_id || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !UUID.test(productId)) return json({ ok: false }, 200);

    const db = supabaseAdmin();
    // Only record against emails we already have a relationship with.
    const [{ data: sub }, { data: ord }, { data: prod }] = await Promise.all([
      db.from('subscribers').select('email').eq('email', email).limit(1),
      db.from('orders').select('id').eq('email', email).eq('status', 'paid').limit(1),
      db.from('products').select('id').eq('id', productId).eq('active', true).limit(1),
    ]);
    if ((!sub?.length && !ord?.length) || !prod?.length) return json({ ok: false }, 200);

    // dedupe: at most one favorite signal per (email, product) per day
    const since = new Date(Date.now() - 86400000).toISOString();
    const { data: recent } = await db.from('browse_events')
      .select('id').eq('email', email).eq('product_id', productId).gte('created_at', since).limit(1);
    if (!recent?.length) await db.from('browse_events').insert({ email, product_id: productId, source: 'favorite' });
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 200);
  }
};
