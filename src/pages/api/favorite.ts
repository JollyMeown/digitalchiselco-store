// Records a "favorite" as an interest signal so it feeds product affinity,
// personalization and price-drop alerts. Only fires when the visitor's email is
// known (logged in / subscribed). Anonymous favorites live in localStorage only.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    const productId = String(body.product_id || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !productId) return json({ ok: false }, 200);
    // dedupe: at most one favorite signal per (email, product) per day
    const since = new Date(Date.now() - 86400000).toISOString();
    const { data: recent } = await supabaseAdmin().from('browse_events')
      .select('id').eq('email', email).eq('product_id', productId).gte('created_at', since).limit(1);
    if (!recent?.length) await supabaseAdmin().from('browse_events').insert({ email, product_id: productId, source: 'favorite' });
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 200);
  }
};
