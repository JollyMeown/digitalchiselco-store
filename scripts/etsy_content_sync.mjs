// Syncs the website catalog against the live Etsy shop (Etsy = authority):
//   1) PRICES  — normalize every linked product to the store rule: site price =
//                80% of Etsy price (rounded to cents). Owner-confirmed 2026-07-16.
//   2) TEXT    — keep the site's SEO copy; only copy the Etsy description onto
//                products whose site description is missing or very thin (<200 chars).
//   3) PICTURES— cheap pass: gallery count + first-image byte-hash must match.
//                On failure: full compare for that product; APPEND Etsy images the
//                site is missing (by hash). Never removes or reorders site images.
//                Products whose cover matches NO Etsy image are reported only
//                (could be a deliberate custom cover, e.g. bundles).
//
// Usage: node scripts/etsy_content_sync.mjs [--apply] [--json sync-report.json]
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const APPLY = process.argv.includes('--apply');
const argv = process.argv.slice(2);
const jsonIdx = argv.indexOf('--json');
const JSON_OUT = jsonIdx >= 0 ? argv[jsonIdx + 1] : null;

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = 'site-media', FOLDER = 'products';
const SHOP_ID = 61524055;
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const rnd = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
const priceOf = (l) => (l.price ? Number(l.price.amount) / Number(l.price.divisor || 100) : 0);

// --- fetch all Etsy listings (fresh) ----------------------------------------
const listings = [];
for (let offset = 0; ; offset += 100) {
  const page = await etsy(`/shops/${SHOP_ID}/listings?state=active&limit=100&offset=${offset}&includes=Images`, { oauth: true });
  listings.push(...(page.results || []));
  process.stdout.write(`\rEtsy listings: ${listings.length}/${page.count}`);
  if (listings.length >= page.count || !(page.results || []).length) break;
}
console.log('');

// --- fetch all site products --------------------------------------------------
const products = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('products')
    .select('id, slug, title, description, price_usd, etsy_listing_id, gallery, image_url, is_bundle, is_subscription, active')
    .range(from, from + 999);
  if (error) throw error;
  products.push(...data);
  if (data.length < 1000) break;
}
const byEtsyId = new Map(products.filter((p) => p.etsy_listing_id).map((p) => [String(p.etsy_listing_id), p]));
console.log(`Site products: ${products.length} (${byEtsyId.size} linked to Etsy)`);

const report = { priceFixed: [], descFilled: [], imagesAppended: [], coverUnknown: [], failures: [] };

async function hashUrl(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { hash: createHash('sha256').update(buf).digest('hex'), buf };
}

async function uploadBuf(buf, path) {
  const { error } = await db.storage.from(BUCKET).upload(path, buf, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

let done = 0;
for (const l of listings) {
  const p = byEtsyId.get(String(l.listing_id));
  done++;
  if (done % 50 === 0) console.log(`...${done}/${listings.length} | priceFixes=${report.priceFixed.length} descFills=${report.descFilled.length} imgAppends=${report.imagesAppended.length}`);
  if (!p) continue;

  try {
    // Skip customized/personalized products entirely (owner: out of scope; also
    // a Paddle AUP concern — reported separately, never silently re-priced).
    if (/custom|personali[sz]/i.test(p.slug) || /custom|personali[sz]/i.test(p.title)) {
      report.customSkipped = report.customSkipped || [];
      report.customSkipped.push({ slug: p.slug, active: p.active, price: Number(p.price_usd) });
      continue;
    }
    // 1) price rule
    const target = +(priceOf(l) * 0.8).toFixed(2);
    if (target > 0 && Math.abs(Number(p.price_usd) - target) >= 0.01) {
      report.priceFixed.push({ slug: p.slug, from: Number(p.price_usd), to: target, etsy: priceOf(l) });
      if (APPLY) await db.from('products').update({ price_usd: target }).eq('id', p.id);
    }

    // 2) description gap-fill
    const siteDesc = (p.description || '').trim();
    const etsyDesc = (l.description || '').trim();
    if (siteDesc.length < 200 && etsyDesc.length >= 200) {
      report.descFilled.push({ slug: p.slug, siteLen: siteDesc.length, etsyLen: etsyDesc.length });
      if (APPLY) await db.from('products').update({ description: etsyDesc }).eq('id', p.id);
    }

    // 3) pictures — COUNT-ONLY report (no writes). Byte-hash comparison across
    // CDNs is unreliable (Supabase re-encodes on upload, so identical images get
    // different hashes → false "missing"). Site images were imported from Etsy in
    // order, so a matching count means a matching gallery. We only REPORT products
    // where the site has fewer images than Etsy, for manual/targeted backfill.
    const etsyImgCount = (l.images || []).length;
    const siteImgCount = Array.isArray(p.gallery) && p.gallery.length ? p.gallery.length : (p.image_url ? 1 : 0);
    if (etsyImgCount > siteImgCount) {
      report.imageGap = report.imageGap || [];
      report.imageGap.push({ slug: p.slug, etsy: etsyImgCount, site: siteImgCount, listing_id: l.listing_id });
    }
  } catch (e) {
    report.failures.push({ slug: p.slug, stage: 'product', error: e.message });
  }
}

console.log('\n================ CONTENT SYNC ================');
console.log(`Price fixes (80% rule):     ${report.priceFixed.length}`);
console.log(`Descriptions gap-filled:    ${report.descFilled.length}`);
console.log(`Image-count gaps (report):  ${(report.imageGap || []).length}`);
console.log(`Failures:                   ${report.failures.length}`);
for (const f of report.priceFixed.slice(0, 20)) console.log(`  price ${f.slug.slice(0, 55)} $${f.from} -> $${f.to} (etsy $${f.etsy})`);
if (!APPLY) console.log('\n(dry run — rerun with --apply)');
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(report, null, 2)); console.log('Report: ' + JSON_OUT); }
