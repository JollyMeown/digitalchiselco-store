// Cults3D: bundles and religious designs sell at the WEBSITE price.
//
// Owner, 2026-09-19: "On cult platform, Bundle and religious items prices to
// be kept as per website prices." The uploader gives every listing a random
// EUR 4.99 / 5.99, which undercuts the website on these (religious designs
// sell at a premium; bundles are several designs). This sets each matching
// listing to products.price_usd in USD, the website's own currency, so the
// two always read the same number.
//
// Matches: products in the "Religious & Christian" or "Premium Bundle Offer"
// category, or is_bundle. Runs LOCALLY (Cults' Cloudflare 403s cloud IPs).
//
//   node scripts/cults3d_reprice.mjs            # dry run: show what would change
//   node scripts/cults3d_reprice.mjs --apply    # update Cults
import 'dotenv/config';

const ENDPOINT = 'https://cults3d.com/graphql';
const USER = process.env.CULTS3D_USERNAME;
const KEY = process.env.CULTS3D_API_KEY;
const SUPA = process.env.PUBLIC_SUPABASE_URL;
const SRV = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const APPLY = process.argv.includes('--apply');
const CATEGORY_SLUGS = ['religious-christian', 'premium-bundle-offer'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!USER || !KEY) { console.error('CULTS3D_USERNAME / CULTS3D_API_KEY missing'); process.exit(1); }

async function gql(query, variables = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2500 * attempt + Math.floor(Math.random() * 2000));
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9', 'user-agent': UA,
        authorization: 'Basic ' + Buffer.from(`${USER}:${KEY}`).toString('base64'),
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (!res.ok) { if (res.status === 403 || res.status === 429 || res.status >= 500) continue; throw new Error(`${res.status} ${text.slice(0, 200)}`); }
    let json; try { json = JSON.parse(text); } catch { continue; }
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
    return json.data;
  }
  throw new Error('cults api unreachable after retries');
}
const sb = async (path) => {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { headers: { apikey: SRV, authorization: `Bearer ${SRV}` } });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

// 1. Website side: every product that should carry its website price on Cults.
const cats = await sb(`categories?select=id,slug&slug=in.(${CATEGORY_SLUGS.join(',')})`);
const catIds = cats.map((c) => c.id);
const links = catIds.length ? await sb(`product_categories?select=product_id,category_id&category_id=in.(${catIds.join(',')})&limit=5000`) : [];
const why = new Map();
for (const l of links) why.set(l.product_id, cats.find((c) => c.id === l.category_id)?.slug === 'religious-christian' ? 'religious' : 'bundle');
const bundles = await sb('products?select=id&is_bundle=eq.true&limit=5000');
for (const b of bundles) if (!why.has(b.id)) why.set(b.id, 'bundle');
const ids = [...why.keys()];
const products = [];
for (let i = 0; i < ids.length; i += 150) {
  products.push(...await sb(`products?select=id,title,price_usd,cults3d_url&cults3d_url=not.is.null&id=in.(${ids.slice(i, i + 150).join(',')})`));
}
const bySlug = new Map(products.map((p) => [String(p.cults3d_url).replace(/[?#].*$/, '').replace(/\/$/, '').split('/').pop(), p]));
// Older duplicate Cults listings of the same design (product.cults3d_url points
// at the newer copy). Same design, same price. Cults slug -> product slug.
const ALIASES = {
  'crown-of-thorns-jesus-sacred-heart-cnc-relief-stl': 'crown-of-thorns-jesus-sacred-heart-cnc-relief-stl-christian-wall-art-panel-relig',
  'baptism-of-jesus-stl-relief-for-cnc': 'baptism-of-jesus-in-jordan-river-stl-file',
  'christ-and-lamb-wolves-bas-relief-stl-john-15-18': null,   // matched by title below
};
// In the religious category by mistake; not a religious design (website $1.59).
const EXCLUDE_TITLE = /carving handbook/i;
{
  const full = await sb(`products?select=id,slug,title,price_usd,cults3d_url&id=in.(${ids.join(',')})`);
  for (const [cultsSlug, prodSlug] of Object.entries(ALIASES)) {
    const p = prodSlug ? full.find((x) => x.slug === prodSlug) : full.find((x) => /Christ Shielding a Lamb from Wolves/i.test(x.title));
    if (p) bySlug.set(cultsSlug, p);
  }
}
console.log(`${ids.length} bundle/religious products on the website, ${products.length} of them listed on Cults.`);

// 2. Cults side: every listing with its current price.
const listings = [];
for (let offset = 0; ; offset += 100) {
  const d = await gql(`query($o:Int){ myself { creationsBatch(limit:100, offset:$o) { total results { id slug name(locale:EN) price(currency:USD){ value } priceEur: price(currency:EUR){ value } } } } }`, { o: offset })
    .catch(async () => gql(`query($o:Int){ myself { creationsBatch(limit:100, offset:$o) { total results { id slug price { value currency } } } } }`, { o: offset }));
  const b = d.myself.creationsBatch;
  listings.push(...b.results);
  if (!b.results.length || listings.length >= b.total) break;
  await sleep(700);
}
console.log(`${listings.length} listings on Cults.\n`);

const plan = [];
for (const l of listings) {
  const p = bySlug.get(l.slug);
  if (!p) continue;
  if (EXCLUDE_TITLE.test(p.title)) { console.log(`  skip (not religious, check its category): ${p.title}`); continue; }
  const target = Math.round(Number(p.price_usd) * 100) / 100;
  if (!(target >= 0.5)) { console.log(`  skip (no valid website price): ${p.title}`); continue; }
  const cur = l.price?.value ?? null; const curCcy = l.price?.currency || 'USD';
  const same = curCcy === 'USD' && Math.abs(Number(cur) - target) < 0.05;
  plan.push({ id: l.id, slug: l.slug, title: String(p.title).split('|')[0].trim(), kind: why.get(p.id), cur, curCcy, target, same, eur: l.priceEur?.value });
}
plan.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
for (const r of plan) {
  console.log(`${r.same ? '=' : '→'} [${r.kind}] ${r.title.slice(0, 60).padEnd(60)} Cults ${r.cur != null ? `${Number(r.cur).toFixed(2)} ${r.curCcy}` : '?'}${r.eur ? ` (€${Number(r.eur).toFixed(2)})` : ''}  →  website $${r.target.toFixed(2)}`);
}
const todo = plan.filter((r) => !r.same);
console.log(`\n${plan.length} matched listings, ${todo.length} need a new price.`);
if (!APPLY) { console.log('Dry run. Re-run with --apply to update Cults.'); process.exit(0); }

let ok = 0, bad = 0;
for (const r of todo) {
  try {
    const d = await gql(`mutation($id:ID!,$p:Float!){ updateCreation(id:$id, downloadPrice:$p, currency:USD){ creation { slug } errors } }`, { id: r.id, p: r.target });
    const errs = d.updateCreation?.errors || [];
    if (errs.length) { bad++; console.log(`  ✗ ${r.title}: ${errs.join('; ')}`); }
    else { ok++; console.log(`  ✓ ${r.title}: $${r.target.toFixed(2)}`); }
  } catch (e) { bad++; console.log(`  ✗ ${r.title}: ${e.message}`); }
  await sleep(900);
}
console.log(`\nDone: ${ok} updated, ${bad} failed.`);
if (bad) process.exit(1);
