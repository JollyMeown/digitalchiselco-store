// Build the dataset behind the State of CNC Relief Carving report.
//
// The report's whole value is that the numbers are first-party and nobody else
// can publish them: 365 days of real Etsy sales across the full catalogue,
// joined to category and price. Everything here is aggregate. No buyer, no
// order and no personal detail of any kind leaves this script, and the output
// is checked into the article rather than queried live so the published figures
// never move under a reader's feet.
//
//   node scripts/relief_report_data.mjs            # writes report_data.json
//
// Country and month splits need the Etsy API (scripts/etsy_buyer_countries.mjs)
// and therefore the VPN off. They are added to this file when that runs; the
// report is written so it stands up without them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const U = cfg('PUBLIC_SUPABASE_URL');
const S = cfg('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: S, authorization: `Bearer ${S}` };

const all = async (table, q) => {
  let out = [], from = 0;
  for (;;) {
    const r = await fetch(`${U}/rest/v1/${table}?${q}&limit=1000&offset=${from}`, { headers: H }).then((x) => x.json());
    if (!Array.isArray(r)) throw new Error(JSON.stringify(r).slice(0, 200));
    out = out.concat(r);
    if (r.length < 1000) break;
    from += 1000;
  }
  return out;
};

// MATURITY CONTROL, and the report is worthless without it.
//
// The raw catalogue says 55% of designs never sold. That number is a lie told
// by arithmetic: 593 designs were added in August and September and have zero
// sales because they have existed for weeks, not because nobody wants them.
// Counting them as failures also manufactured a spectacular fake finding, that
// titles over 90 characters sell nothing, which was simply the new designs
// wearing the new title format.
//
// So every figure below is computed on designs that were listed on Etsy and
// have had a fair run: created before 2026-07-01. That is 1,226 designs and
// 5,344 of the window's 5,427 sales, so almost no real sales are discarded,
// and the honest never-sold rate is 28%, not 55%.
const MATURE_BEFORE = '2026-07-01';
const raw = (await all('products', 'select=id,title,slug,price_usd,etsy_sales_365,active,is_bundle,created_at,etsy_listing_id'))
  .filter((p) => p.etsy_sales_365 !== null && !p.is_bundle);
const products = raw.filter((p) => p.etsy_listing_id && (p.created_at || '') < MATURE_BEFORE);
const excluded = raw.length - products.length;
const cats = await all('categories', 'select=id,name,slug');
const links = await all('product_categories', 'select=product_id,category_id');

const sales = (p) => Number(p.etsy_sales_365) || 0;
const TOTAL = products.reduce((s, p) => s + sales(p), 0);
const N = products.length;

// ── 1. concentration: the long tail is longer than anyone admits ──────────
const sorted = [...products].sort((a, b) => sales(b) - sales(a));
const pointAt = (share) => { let run = 0, i = 0; for (const p of sorted) { run += sales(p); i++; if (run >= TOTAL * share) return i; } return i; };
const concentration = {
  designs: N,
  sales: TOTAL,
  neverSold: products.filter((p) => !sales(p)).length,
  topHalfCount: pointAt(0.5),
  topEightyCount: pointAt(0.8),
  top1pcShare: Math.round(1000 * sorted.slice(0, Math.round(N * 0.01)).reduce((s, p) => s + sales(p), 0) / TOTAL) / 10,
  top10pcShare: Math.round(1000 * sorted.slice(0, Math.round(N * 0.1)).reduce((s, p) => s + sales(p), 0) / TOTAL) / 10,
};

// ── 2. subject: what people actually carve ───────────────────────────────
// Buckets are matched against the listing title. A design can sit in more than
// one bucket (a "bald eagle flag" is both wildlife and patriotic), which is
// honest: the shares describe demand for a THEME, not a partition of sales.
const BUCKETS = [
  ['Religious', /jesus|christ|cross|crucifix|christian|saint|madonna|prayer|angel|church|lord|bible|psalm|guadalupe|last supper/i],
  ['Deer and elk', /\bdeer\b|whitetail|buck|elk|antler|stag|moose/i],
  ['Birds of prey', /eagle|hawk|falcon|owl\b/i],
  ['Wolves and bears', /wolf|wolves|bear\b|grizzly/i],
  ['Fish and fishing', /fish|bass\b|trout|salmon|marlin|angler|fly fishing|lure/i],
  ['Waterfowl and upland', /duck|mallard|pheasant|goose|turkey|quail|waterfowl/i],
  ['Horses and western', /horse|cowboy|western|rodeo|longhorn|saddle|cattle|bull\b/i],
  ['Dogs and cats', /\bdog\b|puppy|retriever|shepherd|labrador|hound|\bcat\b|kitten/i],
  ['Farm and country', /cow\b|highland cow|rooster|chicken|pig\b|barn|farmhouse|tractor/i],
  ['Patriotic and military', /flag|american|patriot|veteran|military|army|navy|marine|soldier|freedom|second amendment/i],
  ['Celtic, Norse and fantasy', /celtic|viking|norse|odin|valkyrie|dragon|knot|yggdrasil|kraken|fantasy|wizard/i],
  ['Nautical and sea life', /anchor|ship\b|nautical|lighthouse|whale|turtle|octopus|shark|mermaid|sea\b|ocean/i],
  ['Floral and botanical', /flower|floral|rose\b|botanical|orchid|sunflower|tree of life|leaf|leaves/i],
  ['Skulls and gothic', /skull|skeleton|gothic|reaper|grim/i],
  ['Holiday and seasonal', /christmas|halloween|easter|santa|pumpkin|ornament|snowman|nativity|thanksgiving/i],
  ['Trays and functional', /tray|bowl|coaster|holder|organizer|valet|hanger|box\b|sign\b/i],
  ['Portrait and figure', /portrait|woman|girl|man\b|face\b|bust\b|lady/i],
];
const subjects = BUCKETS.map(([name, re]) => {
  const hit = products.filter((p) => re.test(p.title || ''));
  const s = hit.reduce((a, p) => a + sales(p), 0);
  const sellers = hit.filter((p) => sales(p)).length;
  return {
    name, designs: hit.length, sales: s,
    share: Math.round(1000 * s / TOTAL) / 10,
    perDesign: hit.length ? Math.round(100 * s / hit.length) / 100 : 0,
    hitRate: hit.length ? Math.round(1000 * sellers / hit.length) / 10 : 0,
    avgPrice: hit.length ? Math.round(100 * hit.reduce((a, p) => a + (Number(p.price_usd) || 0), 0) / hit.length) / 100 : 0,
  };
}).sort((a, b) => b.sales - a.sales);

// ── 3. price: does cheaper actually sell more? ───────────────────────────
const BANDS = [[0, 5], [5, 8], [8, 11], [11, 15], [15, 20], [20, 1e9]];
const priceBands = BANDS.map(([lo, hi]) => {
  const hit = products.filter((p) => { const v = Number(p.price_usd) || 0; return v >= lo && v < hi; });
  const s = hit.reduce((a, p) => a + sales(p), 0);
  return {
    band: hi > 1e8 ? `$${lo}+` : `$${lo} to $${hi}`,
    designs: hit.length, sales: s,
    perDesign: hit.length ? Math.round(100 * s / hit.length) / 100 : 0,
    hitRate: hit.length ? Math.round(1000 * hit.filter((p) => sales(p)).length / hit.length) / 10 : 0,
    revenueShare: Math.round(1000 * hit.reduce((a, p) => a + sales(p) * (Number(p.price_usd) || 0), 0)
      / products.reduce((a, p) => a + sales(p) * (Number(p.price_usd) || 0), 0)) / 10,
  };
});

// Title length was investigated and DELIBERATELY NOT REPORTED. In the mature
// cohort the two bands that exist (under 60 and 60 to 90 characters) sit at a
// 72.0% and 72.7% hit rate, which is no effect at all. The dramatic version of
// this chart only appears if you leave the September designs in.

// ── 5. categories, using the shop's own taxonomy ─────────────────────────
const byId = new Map(products.map((p) => [p.id, p]));
const catSales = new Map();
for (const l of links) {
  const p = byId.get(l.product_id); if (!p) continue;
  const c = catSales.get(l.category_id) || { sales: 0, designs: 0, sellers: 0 };
  c.sales += sales(p); c.designs++; if (sales(p)) c.sellers++;
  catSales.set(l.category_id, c);
}
const categories = cats.map((c) => {
  const v = catSales.get(c.id) || { sales: 0, designs: 0, sellers: 0 };
  return {
    name: c.name, designs: v.designs, sales: v.sales,
    perDesign: v.designs ? Math.round(100 * v.sales / v.designs) / 100 : 0,
    hitRate: v.designs ? Math.round(1000 * v.sellers / v.designs) / 10 : 0,
  };
}).filter((c) => c.designs >= 15).sort((a, b) => b.perDesign - a.perDesign);

const out = {
  generatedAt: new Date().toISOString(),
  window: '365 days to ' + new Date().toISOString().slice(0, 10),
  cohort: { rule: `listed on Etsy and created before ${MATURE_BEFORE}`, designs: N, sales: TOTAL, excluded },
  concentration, subjects, priceBands, categories,
  topDesigns: sorted.slice(0, 20).map((p) => ({ title: (p.title || '').split('|')[0].trim(), slug: p.slug, sales: sales(p), price: Number(p.price_usd) || 0 })),
};
fs.writeFileSync(path.join(HERE, 'blog', 'state-of-cnc-relief-carving-2026', 'report_data.json'), JSON.stringify(out, null, 1));

console.log(`${N} designs, ${TOTAL} sales in the window`);
console.log(`never sold: ${concentration.neverSold} (${Math.round(100 * concentration.neverSold / N)}%)`);
console.log(`top 1% take ${concentration.top1pcShare}% of sales, top 10% take ${concentration.top10pcShare}%`);
console.log('\nSUBJECT                     DESIGNS  SALES  SHARE  PER DESIGN  HIT RATE  AVG PRICE');
for (const s of subjects) console.log(`  ${s.name.padEnd(26)} ${String(s.designs).padStart(5)} ${String(s.sales).padStart(6)} ${(s.share + '%').padStart(6)} ${String(s.perDesign).padStart(11)} ${(s.hitRate + '%').padStart(9)} ${('$' + s.avgPrice).padStart(10)}`);
console.log('\nPRICE BAND        DESIGNS  SALES  PER DESIGN  HIT RATE  REVENUE SHARE');
for (const b of priceBands) console.log(`  ${b.band.padEnd(16)} ${String(b.designs).padStart(5)} ${String(b.sales).padStart(6)} ${String(b.perDesign).padStart(11)} ${(b.hitRate + '%').padStart(9)} ${(b.revenueShare + '%').padStart(14)}`);
console.log('\nCATEGORY (15+ designs)          DESIGNS  PER DESIGN  HIT RATE');
for (const c of categories) console.log(`  ${c.name.slice(0, 30).padEnd(31)} ${String(c.designs).padStart(5)} ${String(c.perDesign).padStart(11)} ${(c.hitRate + '%').padStart(9)}`);
