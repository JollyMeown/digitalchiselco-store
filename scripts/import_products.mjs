// Imports master_products.csv into Supabase.
// Usage: 1) fill .env with SUPABASE creds  2) run schema.sql in Supabase  3) npm run import:products
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const STATUS = { certain: 'certain', likely: 'likely', REVIEW: 'review', 'BUNDLE-MANUAL': 'bundle_manual' };
const rows = parse(readFileSync('master_products.csv'), { columns: true, skip_empty_lines: true });

// 1) categories
const catNames = new Set();
for (const r of rows) (r.all_categories || '').split(' | ').forEach((c) => c && catNames.add(c.trim()));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const cats = [...catNames].map((name, i) => ({ name, slug: slug(name), sort_order: i }));
await db.from('categories').upsert(cats, { onConflict: 'slug' });
const { data: catRows } = await db.from('categories').select('id,name');
const catId = Object.fromEntries((catRows || []).map((c) => [c.name, c.id]));
console.log('categories:', cats.length);

// 2) products + downloads + product_categories
let n = 0;
for (const r of rows) {
  const isBundle = /bundle|mega|membership|subscription/i.test(r.title) || String(r.link_status).startsWith('BUNDLE');
  const isSub = /membership|subscription/i.test(r.title);
  const { data: prod, error } = await db.from('products').upsert({
    etsy_listing_id: r.etsy_listing_id,
    title: r.title,
    slug: r.slug,
    price_usd: Number(r.price_usd) || 0,
    image_url: r.image_url || null,
    is_bundle: isBundle,
    is_subscription: isSub,
    link_status: STATUS[r.link_status] || 'review',
  }, { onConflict: 'etsy_listing_id' }).select('id').single();
  if (error) { console.error(r.etsy_listing_id, error.message); continue; }

  // downloads (split bundle links)
  await db.from('product_downloads').delete().eq('product_id', prod.id);
  const links = (r.download_link || '').split(' | ').map((x) => x.trim()).filter(Boolean);
  if (links.length) {
    await db.from('product_downloads').insert(links.map((link, i) => ({
      product_id: prod.id,
      download_link: link,
      drive_file_id: (link.match(/id=([^&]+)/) || [])[1] || null,
      sort_order: i,
    })));
  }

  // categories
  const myCats = (r.all_categories || '').split(' | ').map((c) => c.trim()).filter(Boolean);
  const pc = myCats.map((c) => catId[c]).filter(Boolean).map((cid) => ({ product_id: prod.id, category_id: cid }));
  if (pc.length) await db.from('product_categories').upsert(pc, { onConflict: 'product_id,category_id' });

  if (++n % 100 === 0) console.log('products:', n);
}
console.log('Done. Imported', n, 'products.');
