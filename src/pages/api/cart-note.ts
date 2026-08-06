// Abandoned-cart capture: the cart page posts {email, items} when the buyer
// types their email. If they never complete payment, the daily cron sends one
// (and only one) reminder — gated by the admin "cart reminders" toggle.

import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp } from '../../lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return new Response(null, { status: 204 });
    if (!(await rateLimit(`cartnote:${clientIp(request)}`, 20, 600))) return new Response(null, { status: 204 });

    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map((x: any) => ({
      id: String(x.id || '').slice(0, 60),
      title: String(x.title || '').slice(0, 160),
      price: Number(x.price) || 0,
      qty: Math.max(1, Number(x.qty) || 1),
    })).filter((x: any) => x.id && x.title);
    if (!items.length) return new Response(null, { status: 204 });
    const subtotal = items.reduce((s: number, x: any) => s + x.price * x.qty, 0);

    const db = supabaseAdmin();
    // one open row per email (unique partial index) — refresh it on every note
    const { error } = await db.from('abandoned_carts')
      .update({ cart: items, subtotal, updated_at: new Date().toISOString() })
      .ilike('email', email).is('recovered_at', null);
    // update touches 0 rows when there is no open cart yet → insert
    const { data: existing } = await db.from('abandoned_carts').select('id').ilike('email', email).is('recovered_at', null).limit(1);
    if (!existing?.length) await db.from('abandoned_carts').insert({ email, cart: items, subtotal });
    void error;
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
};
