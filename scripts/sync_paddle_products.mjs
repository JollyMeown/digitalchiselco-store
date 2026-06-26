// Sync Supabase products → Paddle catalog (products + prices).
// On each run, this script:
//   1. Fetches products from Supabase missing paddle_price_id
//   2. Creates a Paddle product (digital-goods tax category)
//   3. Creates a USD price for it
//   4. Stores the resulting paddle_product_id + paddle_price_id back in Supabase
//
// Also syncs membership_plans the same way.
//
// Usage:
//   node scripts/sync_paddle_products.mjs              # all unsynced products + plans
//   node scripts/sync_paddle_products.mjs --limit 10   # only first 10 (for testing)
//   node scripts/sync_paddle_products.mjs --plans-only # only membership plans
//
// Environment uses PADDLE_ENV (sandbox/production) and PADDLE_API_KEY from .env.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PADDLE_KEY   = process.env.PADDLE_API_KEY;
const PADDLE_ENV   = process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox';
const PADDLE_BASE  = PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

for (const [k, v] of Object.entries({ PUBLIC_SUPABASE_URL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, PADDLE_API_KEY: PADDLE_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const LIMIT      = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? parseInt(process.argv[i + 1], 10) : Infinity; })();
const PLANS_ONLY = process.argv.includes('--plans-only');
const DEFAULT_DISCOUNT = 20;  // matches DEFAULT_DISCOUNT in src/lib/pricing.ts; we discount before sending to Paddle

async function paddleApi(path, init = {}) {
  const url = PADDLE_BASE + path;
  const res = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      authorization: `Bearer ${PADDLE_KEY}`,
      'content-type': 'application/json',
      'paddle-version': '1',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const detail = data?.error?.detail || data?.error?.message || text.slice(0, 300);
    throw new Error(`Paddle ${res.status} ${path}: ${detail}`);
  }
  return data;
}

async function createProductAndPrice({ name, description, amountCents }) {
  // 1) Create product
  const prod = await paddleApi('/products', {
    method: 'POST',
    body: {
      name: name.slice(0, 200),
      description: (description || name).slice(0, 200),
      tax_category: 'standard',
      type: 'standard',
      custom_data: { source: 'digitalchiselco' },
    },
  });
  const productId = prod.data.id;

  // 2) Create price tied to the product
  const price = await paddleApi('/prices', {
    method: 'POST',
    body: {
      product_id: productId,
      description: name.slice(0, 200),
      unit_price: { amount: String(amountCents), currency_code: 'USD' },
      tax_mode: 'account_setting',
      quantity: { minimum: 1, maximum: 100 },
    },
  });
  return { productId, priceId: price.data.id };
}

function applyDiscount(priceUsd, percent = DEFAULT_DISCOUNT) {
  if (!percent || percent <= 0 || percent >= 100) return priceUsd;
  return Math.max(0, +(priceUsd * (100 - percent) / 100).toFixed(2));
}

async function syncProducts() {
  console.log(`\n[Products] Fetching unsynced from Supabase…`);
  const { data: rows, error } = await db
    .from('products')
    .select('id, title, slug, price_usd, paddle_price_id, description')
    .eq('active', true)
    .is('paddle_price_id', null)
    .order('title');
  if (error) { console.error(error.message); return; }
  const todo = (rows || []).slice(0, Math.min(LIMIT, (rows || []).length));
  console.log(`[Products] ${rows?.length || 0} unsynced; processing ${todo.length}.`);

  let ok = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    try {
      const discounted = applyDiscount(Number(p.price_usd));
      const cents = Math.round(discounted * 100);
      if (cents < 1) { console.log(`  SKIP [${i+1}/${todo.length}] ${p.slug} — price < $0.01`); continue; }
      const { productId, priceId } = await createProductAndPrice({
        name: p.title,
        description: (p.description || p.title).slice(0, 200),
        amountCents: cents,
      });
      const { error: updErr } = await db.from('products')
        .update({ paddle_product_id: productId, paddle_price_id: priceId })
        .eq('id', p.id);
      if (updErr) throw new Error('DB update: ' + updErr.message);
      console.log(`  OK [${i+1}/${todo.length}] ${p.slug.slice(0, 50)} → ${priceId} ($${discounted.toFixed(2)})`);
      ok++;
    } catch (e) {
      console.error(`  FAIL [${i+1}/${todo.length}] ${p.slug}: ${e.message}`);
      fail++;
    }
  }
  console.log(`[Products] Done. Success ${ok}, failed ${fail}.`);
}

async function syncMembershipPlans() {
  console.log(`\n[Membership plans] Fetching unsynced…`);
  const { data: plans, error } = await db
    .from('membership_plans')
    .select('id, slug, name, price_usd, paddle_price_id, months, files_per_month')
    .eq('active', true)
    .is('paddle_price_id', null)
    .order('sort_order');
  if (error) { console.error(error.message); return; }
  console.log(`[Membership plans] ${plans?.length || 0} unsynced.`);

  for (const p of (plans || [])) {
    try {
      const cents = Math.round(Number(p.price_usd) * 100);
      const { productId, priceId } = await createProductAndPrice({
        name: p.name,
        description: `${p.months}-month membership · ${p.files_per_month} STL files per month`,
        amountCents: cents,
      });
      await db.from('membership_plans').update({ paddle_product_id: productId, paddle_price_id: priceId }).eq('id', p.id);
      console.log(`  OK ${p.slug} → ${priceId}`);
    } catch (e) {
      console.error(`  FAIL ${p.slug}: ${e.message}`);
    }
  }
}

(async () => {
  console.log(`=== Paddle sync (${PADDLE_ENV}) ===`);
  await syncMembershipPlans();   // always sync plans (cheap, max 2-3 rows)
  if (!PLANS_ONLY) await syncProducts();
  console.log('\nDone.');
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
