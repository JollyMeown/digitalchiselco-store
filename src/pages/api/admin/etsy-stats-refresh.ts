// Feature 1 (one-click) — refresh the homepage stats live from the Etsy shop.
// Self-contained: hits the PUBLIC Etsy shop endpoint (no OAuth needed for
// sales / rating / reviews / active-listing counts), writes them into
// site_settings, and returns the new numbers so the admin UI can show them.
// Admirers (num_favorers) needs OAuth paging, so it's left to the local
// `npm run etsy:stats` script; this route updates everything else instantly.

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const ETSY_API_KEY = process.env.ETSY_API_KEY || import.meta.env.ETSY_API_KEY || '';
const ETSY_SHARED_SECRET = process.env.ETSY_SHARED_SECRET || import.meta.env.ETSY_SHARED_SECRET || '';
const SHOP_NAME = process.env.ETSY_SHOP_NAME || 'DigitalChiselCo';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function apiKeyHeader() {
  if (ETSY_API_KEY.includes(':')) return ETSY_API_KEY;
  return ETSY_SHARED_SECRET ? `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}` : ETSY_API_KEY;
}

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  const admin = supabaseAdmin();
  const { data: prof } = await admin.from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'unauthorized' }, 401);
  if (!ETSY_API_KEY) return json({ error: 'ETSY_API_KEY is not set on the server.' }, 503);

  let shop: any;
  try {
    const res = await fetch(
      `https://openapi.etsy.com/v3/application/shops?shop_name=${encodeURIComponent(SHOP_NAME)}`,
      { headers: { 'x-api-key': apiKeyHeader() } });
    if (!res.ok) return json({ error: `Etsy ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
    const found = await res.json();
    shop = (found.results || []).find((x: any) => x.shop_name?.toLowerCase() === SHOP_NAME.toLowerCase())
      || found.results?.[0];
  } catch (e: any) {
    return json({ error: 'Failed to reach Etsy', detail: String(e?.message || e) }, 502);
  }
  if (!shop) return json({ error: `No Etsy shop matching "${SHOP_NAME}"` }, 404);

  const patch: Record<string, unknown> = {
    sales_count: Number(shop.transaction_sold_count) || 0,
    products_count: Number(shop.listing_active_count) || 0,
    etsy_synced_at: new Date().toISOString(),
  };
  if (shop.review_count != null) patch.reviews_count = Number(shop.review_count);
  if (shop.review_average != null) patch.rating = Math.round(Number(shop.review_average) * 10) / 10;

  const { error } = await supabaseAdmin().from('site_settings').update(patch).eq('id', 1);
  if (error) return json({ error: 'Supabase update failed', detail: error.message }, 500);

  return json({ ok: true, updated: patch, note: 'Admirers require the local `npm run etsy:stats` sync.' });
};
