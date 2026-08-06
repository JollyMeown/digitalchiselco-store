// Imports Etsy listings that exist in the shop but not in the website catalog,
// using the listing objects captured in etsy-audit-report.json (run
// scripts/etsy_audit.mjs --json etsy-audit-report.json first).
//
// Policy:
//   - SKIPS customized/personalized products, Laser Studio software listings
//     (site has its own page) and custom services like "Picture to 3D".
//   - Website price = 80% of Etsy price (the store's standard Etsy-divert rule).
//   - Products land INACTIVE with link_status='review' — they must get a
//     download link attached (admin) before going live. Where a Drive STL from
//     drive_stls.json matches the title strongly and isn't used by any other
//     product, it is pre-attached as a suggestion (still inactive, still review).
//
// Usage: node scripts/etsy_import_missing.mjs [--apply]   (dry run without --apply)
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = 'site-media', FOLDER = 'products', MAX_IMAGES = 10;

const report = JSON.parse(readFileSync('etsy-audit-report.json', 'utf8'));
const candidates = report.onEtsyNotSite || [];

const EXCLUDE = /custom|personali[sz]|made to order|picture to 3d|laser studio|laser engraver\s+software/i;

// --- category mapping (first match wins) -------------------------------------
const CAT_RULES = [
  [/jesus|christ|sacred|catholic|crucifix|cross|angel|faith|gethsemane|risen|last supper|religious/i, 'religious-christian'],
  [/veteran|military|memorial/i, 'memorial-tribute'],
  [/eagle|patriotic|american flag/i, 'bald-eagle-patriotic'],
  [/hunting|labrador|retriever|waterfowl|duck hunting/i, 'hunting-lodge-decor'],
  [/pike|bass|fishing|sturgeon|creel|angler/i, 'fish-fly-fishing-stl'],
  [/owl|cardinal|hummingbird|bird/i, 'flying-ducks-owl-birds'],
  [/turtle|whale|crab|lobster|ocean|sea |nautical/i, 'coastal-nautical'],
  [/farm|barn|tractor|harvest|milk|pig|piglet|rooster|hen|highland cow|corn|silo|collie|sheep/i, 'farmhouse-country'],
  [/moose|elk|deer|bear|wolf|wildlife|fawn/i, 'wildlife-wall-art-stl'],
  [/cowboy|western|saloon/i, 'cowboy-western'],
  [/skull|gothic|plague/i, 'gothic-skull-art'],
  [/bundle/i, 'premium-bundle-offer'],
];

const NOISE = new Set(['stl', 'file', 'files', 'cnc', 'router', '3d', 'digital', 'download', 'model', 'design', 'relief', 'wood', 'wooden', 'carving', 'for', 'the', 'and', 'with', 'art', 'wall', 'decor']);
const tokenize = (s) => (s || '').toLowerCase().replace(/\.stl$/i, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !NOISE.has(w));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80).replace(/-$/, '');
const cleanTitle = (s) => s.replace(/\s*\|\s*/g, ' | ').replace(/\s{2,}/g, ' ').replace(/\s*\|\s*$/, '').trim();
const rnd = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
const priceOf = (l) => (l.price ? Number(l.price.amount) / Number(l.price.divisor || 100) : 0);

// --- existing state -----------------------------------------------------------
const { data: catRows } = await db.from('categories').select('id, slug');
const catBySlug = new Map((catRows || []).map((c) => [c.slug, c.id]));
const existingSlugs = new Set();
const usedDriveIds = new Set();
for (let from = 0; ; from += 1000) {
  const { data } = await db.from('products').select('slug').range(from, from + 999);
  (data || []).forEach((p) => existingSlugs.add(p.slug));
  if (!data || data.length < 1000) break;
}
for (let from = 0; ; from += 1000) {
  const { data } = await db.from('product_downloads').select('drive_file_id, download_link').range(from, from + 999);
  (data || []).forEach((d) => {
    const id = d.drive_file_id || (d.download_link?.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || [])[1];
    if (id) usedDriveIds.add(id);
  });
  if (!data || data.length < 1000) break;
}
const driveStls = JSON.parse(readFileSync('drive_stls.json', 'utf8'));

function bestDriveMatch(title) {
  const t = new Set(tokenize(title));
  let best = null;
  for (const f of driveStls) {
    if (usedDriveIds.has(f.id)) continue;
    const ftok = tokenize(f.name);
    if (!ftok.length) continue;
    const hits = ftok.filter((w) => t.has(w)).length;
    const score = hits / ftok.length;
    if (!best || score > best.score) best = { score, id: f.id, name: f.name };
  }
  return best && best.score >= 0.6 ? best : null;
}

async function uploadImage(url, path) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) return null;
  const { error } = await db.storage.from(BUCKET).upload(path, buf, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// --- run -----------------------------------------------------------------------
let imported = 0, skipped = 0;
for (const l of candidates) {
  const title = cleanTitle(l.title || '');
  if (EXCLUDE.test(title) || l.is_customizable || l.is_personalizable) {
    console.log(`SKIP (excluded): ${title.slice(0, 70)}`);
    skipped++;
    continue;
  }
  const etsyPrice = priceOf(l);
  const sitePrice = +(etsyPrice * 0.8).toFixed(2);
  let slug = slugify(title);
  if (existingSlugs.has(slug)) slug = `${slug}-${l.listing_id}`.slice(0, 90);
  const isBundle = /bundle|mega/i.test(title);
  const catRule = CAT_RULES.find(([re]) => re.test(title));
  const catId = catRule ? catBySlug.get(catRule[1]) : null;
  const driveMatch = bestDriveMatch(title);

  console.log(`\n[${l.listing_id}] ${title.slice(0, 70)}`);
  console.log(`  slug=${slug}`);
  console.log(`  price: etsy $${etsyPrice} -> site $${sitePrice} | bundle=${isBundle} | category=${catRule ? catRule[1] : '(none)'} | images=${(l.images || []).length}`);
  if (driveMatch) console.log(`  drive suggestion (${Math.round(driveMatch.score * 100)}%): ${driveMatch.name.slice(0, 70)}`);

  if (!APPLY) continue;

  // images
  const urls = [];
  const imgs = (l.images || []).slice(0, MAX_IMAGES);
  for (let i = 0; i < imgs.length; i++) {
    const src = imgs[i].url_fullxfull || imgs[i].url_570xN;
    if (!src) continue;
    try {
      const u = await uploadImage(src, `${FOLDER}/${slug}-g${i + 1}-${rnd()}.jpg`);
      if (u) urls.push(u);
    } catch (e) { console.log(`  image ${i + 1} failed: ${e.message}`); }
  }

  const { data: prod, error } = await db.from('products').upsert({
    etsy_listing_id: String(l.listing_id),
    title,
    original_title: l.title,
    slug,
    description: (l.description || '').trim(),
    price_usd: sitePrice,
    image_url: urls[0] || null,
    gallery: urls,
    is_bundle: isBundle,
    is_subscription: false,
    active: false,
    link_status: 'review',
  }, { onConflict: 'etsy_listing_id' }).select('id').single();
  if (error) { console.log(`  DB ERROR: ${error.message}`); continue; }

  if (catId) await db.from('product_categories').upsert({ product_id: prod.id, category_id: catId }, { onConflict: 'product_id,category_id' });
  if (driveMatch) {
    await db.from('product_downloads').insert({
      product_id: prod.id,
      download_link: `https://drive.google.com/uc?export=download&id=${driveMatch.id}`,
      drive_file_id: driveMatch.id,
      sort_order: 0,
    });
    usedDriveIds.add(driveMatch.id);
  }
  existingSlugs.add(slug);
  imported++;
  console.log(`  ✓ imported (inactive, ${urls.length} images${driveMatch ? ', drive link suggested' : ', no download link'})`);
}

console.log(`\n${APPLY ? 'IMPORTED' : 'WOULD IMPORT'}: ${candidates.length - skipped}  |  skipped: ${skipped}${APPLY ? '' : '\n(dry run — rerun with --apply)'}`);
