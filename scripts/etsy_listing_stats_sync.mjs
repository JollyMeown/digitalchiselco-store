// Per-listing Etsy views + favorers → etsy_listing_stats. Runs LOCALLY inside
// run_finance_refresh.cmd (this machine holds the Etsy OAuth token). The
// previous values roll into *_prev so readers get a since-last-sync delta,
// which is the "what is trending on Etsy right now" signal Design Scout uses.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const me = await etsy('/users/me', { oauth: true });
const shop = await etsy(`/users/${me.user_id}/shops`, { oauth: true });
console.log(`listing stats: shop ${shop.shop_name} (${shop.shop_id})`);

// Only roll prev← current when the last sync is older than 20h, so re-running
// the cmd twice in a day never zeroes the deltas.
const { data: existing } = await db.from('etsy_listing_stats').select('listing_id, views, favorers, updated_at').limit(5000);
const prior = new Map((existing || []).map((r) => [Number(r.listing_id), r]));
const cutoff = Date.now() - 20 * 3600 * 1000;

let offset = 0, upserted = 0;
for (;;) {
  const page = await etsy(`/shops/${shop.shop_id}/listings?state=active&limit=100&offset=${offset}`, { oauth: true });
  const rows = page.results || [];
  if (!rows.length) break;
  const batch = rows.map((l) => {
    const old = prior.get(Number(l.listing_id));
    const stale = !old || Date.parse(old.updated_at) < cutoff;
    return {
      listing_id: l.listing_id,
      title: String(l.title || '').slice(0, 300),
      views: Number(l.views) || 0,
      favorers: Number(l.num_favorers) || 0,
      views_prev: old ? (stale ? old.views : undefined) : Number(l.views) || 0,
      favorers_prev: old ? (stale ? old.favorers : undefined) : Number(l.num_favorers) || 0,
      updated_at: new Date().toISOString(),
    };
  }).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));
  const { error } = await db.from('etsy_listing_stats').upsert(batch, { onConflict: 'listing_id' });
  if (error) { console.error('upsert failed:', error.message); process.exit(1); }
  upserted += batch.length;
  offset += 100;
  if (rows.length < 100) break;
}
console.log(`✓ etsy listing stats: ${upserted} listings updated`);
