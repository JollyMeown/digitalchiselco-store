// Public feed of recent purchases for the storefront social-proof popup.
// Anonymized (no buyer identity) — just the design, a relative time, and a
// rough region bucket when available. Cached at the edge for a minute.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;

export const GET: APIRoute = async () => {
  const db = supabaseAdmin();
  const { data: orders } = await db.from('orders')
    .select('id, created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(40);
  const ids = (orders || []).map((o) => o.id);
  const timeById = new Map((orders || []).map((o) => [o.id, o.created_at]));
  let items: any[] = [];
  if (ids.length) {
    const { data: oi } = await db.from('order_items').select('order_id, product_id, title').in('order_id', ids).limit(120);
    // one line per order, most recent first, unique designs
    const seen = new Set<string>();
    for (const it of oi || []) {
      const key = String(it.product_id || it.title);
      if (seen.has(key)) continue; seen.add(key);
      items.push({ title: String(it.title || '').split('|')[0].trim().slice(0, 60), product_id: it.product_id, at: timeById.get(it.order_id) });
      if (items.length >= 12) break;
    }
  }
  // attach a thumbnail + slug
  const pids = items.map((i) => i.product_id).filter(Boolean);
  if (pids.length) {
    const { data: prods } = await db.from('products').select('id, slug, image_url').in('id', pids);
    const meta = new Map((prods || []).map((p) => [p.id, p]));
    items = items.map((i) => ({ ...i, ...(meta.get(i.product_id) || {}) }));
  }
  return new Response(JSON.stringify({ items }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60, s-maxage=60' },
  });
};
