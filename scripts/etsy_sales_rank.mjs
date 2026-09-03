// Rank products by REAL sales, from Etsy receipts of the last 365 days.
//
// Almost all sales happen on Etsy, so this is the only honest answer to "what
// are our best sellers". Writes products.etsy_sales_365 (+ etsy_sales_at) so
// every other job can simply order by it: which products get marketing images
// first, which designs lead a bundle, which listings deserve SEO attention.
//
// Runs on the machine that holds the Etsy OAuth token. NEVER run it alongside
// another Etsy script: Etsy rotates the refresh token on every refresh.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { etsy, getAccessToken } from './etsy_client.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const U = cfg('PUBLIC_SUPABASE_URL');
const H = { apikey: cfg('SUPABASE_SERVICE_ROLE_KEY'), authorization: `Bearer ${cfg('SUPABASE_SERVICE_ROLE_KEY')}`, 'content-type': 'application/json' };

if (!(await getAccessToken())) { console.error('no Etsy token on this machine'); process.exit(1); }
const me = await etsy('/users/me', { oauth: true });
const since = Math.floor(Date.now() / 1000) - 365 * 86400;

console.log('reading receipts…');
const sold = new Map();          // listing_id -> quantity
let receipts = 0;
for (let offset = 0; offset <= 10000; offset += 100) {
  const r = await etsy(`/shops/${me.shop_id}/receipts?limit=100&offset=${offset}&min_created=${since}`, { oauth: true });
  const batch = r.results || [];
  receipts += batch.length;
  for (const rc of batch) {
    for (const t of rc.transactions || []) {
      const id = Number(t.listing_id);
      if (id) sold.set(id, (sold.get(id) || 0) + (Number(t.quantity) || 1));
    }
  }
  if (batch.length < 100) break;
}
console.log(`${receipts} receipts · ${sold.size} listings with at least one sale`);

// Map Etsy listing ids onto our products.
let products = [], from = 0;
while (true) {
  const page = await fetch(`${U}/rest/v1/products?select=id,slug,etsy_listing_id,etsy_sales_365&etsy_listing_id=not.is.null`, {
    headers: { ...H, range: `${from}-${from + 999}` },
  }).then((r) => r.json());
  if (!Array.isArray(page) || !page.length) break;
  products = products.concat(page);
  if (page.length < 1000) break;
  from += 1000;
}
console.log(`${products.length} products linked to an Etsy listing`);

const now = new Date().toISOString();
let changed = 0;
for (const p of products) {
  const n = sold.get(Number(p.etsy_listing_id)) || 0;
  if (n === (p.etsy_sales_365 || 0)) continue;
  const r = await fetch(`${U}/rest/v1/products?id=eq.${p.id}`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ etsy_sales_365: n, etsy_sales_at: now }),
  });
  if (r.ok) changed++;
}

const top = products
  .map((p) => ({ slug: p.slug, n: sold.get(Number(p.etsy_listing_id)) || 0 }))
  .sort((a, b) => b.n - a.n).slice(0, 10);
console.log(`updated ${changed} product(s)\n\ntop 10 sellers (365d):`);
top.forEach((t, i) => console.log(`${String(i + 1).padStart(3)}. ${String(t.n).padStart(3)} × ${t.slug.slice(0, 60)}`));
