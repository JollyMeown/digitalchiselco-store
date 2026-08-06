// Cross-checks the website catalog (Supabase products) against the shop's
// LIVE Etsy listings using the Etsy Open API v3.
//
// Auth: only ETSY_API_KEY (the app Keystring) is needed — active listings are
// public data, no OAuth. Draft/expired listings are NOT visible this way, so
// "on site but not active on Etsy" may mean draft/expired rather than deleted.
//
// Usage: node scripts/etsy_audit.mjs [--shop DigitalChiselCo] [--json report.json]
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { etsy, getAccessToken } from './etsy_client.mjs';

if (!process.env.ETSY_API_KEY) {
  console.error('ETSY_API_KEY missing from .env — add the app Keystring first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const SHOP_NAME = argVal('--shop', process.env.ETSY_SHOP_NAME || 'DigitalChiselCo');
const JSON_OUT = argVal('--json', null);

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Anonymous requests cap listing pagination at offset 100; with OAuth we can
// walk the whole shop. Fall back gracefully if OAuth hasn't been set up yet.
const hasOAuth = !!(await getAccessToken().catch(() => null));
if (!hasOAuth) console.log('NOTE: no OAuth token (run scripts/etsy_oauth.mjs) — anonymous mode reads only the first ~100 listings.\n');

// --- 1. Resolve the shop id from its name -----------------------------------
const found = await etsy(`/shops?shop_name=${encodeURIComponent(SHOP_NAME)}`);
const shop = (found.results || []).find((s) => s.shop_name.toLowerCase() === SHOP_NAME.toLowerCase()) || found.results?.[0];
if (!shop) {
  console.error(`No Etsy shop found matching "${SHOP_NAME}". Pass --shop <name>.`);
  process.exit(1);
}
console.log(`Shop: ${shop.shop_name} (id ${shop.shop_id}) — ${shop.listing_active_count} active listings, ${shop.transaction_sold_count} lifetime sales\n`);

// --- 2. Pull ALL active listings (paginated, 100/page) ----------------------
// With OAuth use the seller endpoint (full catalog + Images); anonymously fall
// back to the public one (capped at offset 100).
const etsyListings = [];
for (let offset = 0; ; offset += 100) {
  let page;
  try {
    page = hasOAuth
      ? await etsy(`/shops/${shop.shop_id}/listings?state=active&limit=100&offset=${offset}&includes=Images`, { oauth: true })
      : await etsy(`/shops/${shop.shop_id}/listings/active?limit=100&offset=${offset}`);
  } catch (e) {
    if (/Offset exceeds/.test(e.message)) { console.log('\n(anonymous offset cap reached — partial audit)'); break; }
    throw e;
  }
  etsyListings.push(...(page.results || []));
  process.stdout.write(`\rFetched ${etsyListings.length}/${page.count} Etsy listings...`);
  if (etsyListings.length >= page.count || !(page.results || []).length) break;
}
console.log('');

// --- 3. Pull ALL website products (paginate past the 1000-row cap) ----------
const products = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('products')
    .select('id, slug, title, price_usd, etsy_listing_id, active, gallery, image_url')
    .range(from, from + 999);
  if (error) throw error;
  products.push(...data);
  if (data.length < 1000) break;
}
console.log(`Website products: ${products.length} (${products.filter((p) => p.active).length} active)\n`);

// --- 4. Cross-check ----------------------------------------------------------
const siteByEtsyId = new Map(products.filter((p) => p.etsy_listing_id).map((p) => [String(p.etsy_listing_id), p]));
const etsyById = new Map(etsyListings.map((l) => [String(l.listing_id), l]));

const priceOf = (l) => (l.price ? Number(l.price.amount) / Number(l.price.divisor || 100) : null);

const onEtsyNotSite = etsyListings.filter((l) => !siteByEtsyId.has(String(l.listing_id)));
const onSiteNotEtsy = products.filter((p) => p.etsy_listing_id && p.active && !etsyById.has(String(p.etsy_listing_id)));
const nativeOnly = products.filter((p) => !p.etsy_listing_id && p.active);
const priceMismatch = [];
for (const l of etsyListings) {
  const p = siteByEtsyId.get(String(l.listing_id));
  if (!p) continue;
  const ep = priceOf(l);
  if (ep != null && Math.abs(ep - Number(p.price_usd)) >= 0.01) {
    priceMismatch.push({ slug: p.slug, title: p.title.slice(0, 60), site: Number(p.price_usd), etsy: ep, listing_id: l.listing_id });
  }
}

// Title check — normalized comparison (case/punctuation/whitespace-insensitive)
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const titleMismatch = [];
for (const l of etsyListings) {
  const p = siteByEtsyId.get(String(l.listing_id));
  if (!p) continue;
  if (norm(l.title) !== norm(p.title)) {
    titleMismatch.push({ slug: p.slug, listing_id: l.listing_id, site_title: p.title, etsy_title: l.title });
  }
}

// Picture check — website gallery should have at least as many images as Etsy
const imageGap = [];
for (const l of etsyListings) {
  const p = siteByEtsyId.get(String(l.listing_id));
  if (!p || !Array.isArray(l.images)) continue;
  const siteCount = Array.isArray(p.gallery) && p.gallery.length ? p.gallery.length : (p.image_url ? 1 : 0);
  if (siteCount < l.images.length) {
    imageGap.push({ slug: p.slug, listing_id: l.listing_id, title: p.title.slice(0, 60), etsy_images: l.images.length, site_images: siteCount, etsy_image_urls: l.images.map((i) => i.url_fullxfull || i.url_570xN).filter(Boolean) });
  }
}

// Demand signals — top listings by favorites and views
const top = [...etsyListings]
  .sort((a, b) => (b.num_favorers || 0) - (a.num_favorers || 0))
  .slice(0, 15)
  .map((l) => ({
    listing_id: l.listing_id,
    title: (l.title || '').slice(0, 70),
    favorites: l.num_favorers || 0,
    views: l.views || 0,
    on_site: siteByEtsyId.has(String(l.listing_id)),
  }));

// --- 5. Report ---------------------------------------------------------------
console.log('================ CROSS-CHECK REPORT ================');
console.log(`Matched (Etsy active <-> site):        ${etsyListings.length - onEtsyNotSite.length}`);
console.log(`On Etsy but NOT on website:            ${onEtsyNotSite.length}`);
console.log(`On website (linked+active) not on Etsy: ${onSiteNotEtsy.length}  (may be draft/expired on Etsy)`);
console.log(`Website-native (never on Etsy):        ${nativeOnly.length}`);
console.log(`Price mismatches:                      ${priceMismatch.length}`);
console.log(`Title mismatches:                      ${titleMismatch.length}`);
console.log(`Site has fewer images than Etsy:       ${imageGap.length}`);

const show = (rows, fmt, cap = 20) => {
  rows.slice(0, cap).forEach((r) => console.log('  - ' + fmt(r)));
  if (rows.length > cap) console.log(`  ...and ${rows.length - cap} more`);
};

if (onEtsyNotSite.length) {
  console.log('\n--- On Etsy, missing from website ---');
  show(onEtsyNotSite, (l) => `[${l.listing_id}] $${priceOf(l)} ${(l.title || '').slice(0, 70)}`);
}
if (onSiteNotEtsy.length) {
  console.log('\n--- On website, not active on Etsy ---');
  show(onSiteNotEtsy, (p) => `[${p.etsy_listing_id}] $${p.price_usd} ${p.title.slice(0, 70)}`);
}
if (priceMismatch.length) {
  console.log('\n--- Price mismatches (site vs Etsy) ---');
  show(priceMismatch, (m) => `site $${m.site} vs etsy $${m.etsy}  ${m.title}`);
}
if (titleMismatch.length) {
  console.log('\n--- Title mismatches ---');
  show(titleMismatch, (m) => `${m.slug}\n      site: ${m.site_title.slice(0, 80)}\n      etsy: ${m.etsy_title.slice(0, 80)}`, 10);
}
if (imageGap.length) {
  console.log('\n--- Website missing images vs Etsy ---');
  show(imageGap, (m) => `site ${m.site_images} vs etsy ${m.etsy_images} imgs  ${m.title}`);
}
console.log('\n--- Top 15 Etsy listings by favorites (demand signal) ---');
top.forEach((t) => console.log(`  ${String(t.favorites).padStart(4)} favs  ${String(t.views ?? '?').padStart(6)} views  ${t.on_site ? '' : '[NOT ON SITE] '}${t.title}`));

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ shop: { id: shop.shop_id, name: shop.shop_name }, onEtsyNotSite, onSiteNotEtsy, priceMismatch, titleMismatch, imageGap, top, counts: { etsyActive: etsyListings.length, siteProducts: products.length } }, null, 2));
  console.log(`\nFull report written to ${JSON_OUT}`);
}
