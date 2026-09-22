// Where do Etsy buyers actually live, and what does each country buy?
//
// The finance refresh already walks every receipt but only sums the money. The
// receipt also carries the buyer's country and the listings bought, which is
// the only first-party evidence available about which nations buy these
// designs and which subjects they choose. 3,963 receipts is a real sample.
//
//   node scripts/etsy_buyer_countries.mjs            # full run, writes JSON
//   node scripts/etsy_buyer_countries.mjs --limit 5  # first 5 pages, a taste
//
// NEEDS THE VPN OFF: openapi.etsy.com is unreachable through it.
import 'dotenv/config';
import fs from 'node:fs';

const KEY = process.env.ETSY_API_KEY || process.env.ETSY_KEYSTRING;
const TOKEN = process.env.ETSY_ACCESS_TOKEN;
const SHOP = process.env.ETSY_SHOP_ID;
if (!KEY || !TOKEN || !SHOP) { console.error('need ETSY_API_KEY, ETSY_ACCESS_TOKEN, ETSY_SHOP_ID in .env'); process.exit(1); }

const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : Infinity; })();

async function etsy(path) {
  const r = await fetch('https://openapi.etsy.com/v3/application' + path, {
    headers: { 'x-api-key': KEY, authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

const byCountry = {};
const subjectsByCountry = {};
let receipts = 0, pages = 0;

for (let offset = 0; ; offset += 100) {
  if (pages >= LIMIT) break;
  let page;
  try { page = await etsy(`/shops/${SHOP}/receipts?limit=100&offset=${offset}&includes=Transactions`); }
  catch (e) { console.error('receipts failed:', e.message.slice(0, 120)); break; }
  const rows = page.results || [];
  if (!rows.length) break;
  pages++;
  for (const r of rows) {
    receipts++;
    const c = (r.country_iso || r.buyer_country_iso || '??').toUpperCase();
    const usd = (Number(r.grandtotal?.amount) || 0) / (Number(r.grandtotal?.divisor) || 100);
    const b = byCountry[c] = byCountry[c] || { orders: 0, usd: 0 };
    b.orders++; b.usd += usd;
    for (const t of r.transactions || []) {
      const title = String(t.title || '').toLowerCase();
      const s = subjectsByCountry[c] = subjectsByCountry[c] || {};
      // crude subject buckets, enough to see a national preference
      for (const [bucket, re] of [
        ['religious', /jesus|christ|cross|christian|saint|madonna|prayer|angel|church|crucifix/],
        ['wildlife', /deer|elk|wolf|bear|eagle|duck|fish|bass|turkey|buck|antler|moose|hunting/],
        ['pets', /dog|cat|puppy|retriever|shepherd|horse|pet portrait/],
        ['patriotic', /flag|american|eagle|military|veteran|army|navy|marine|freedom/],
        ['floral', /flower|floral|rose|leaf|tree of life|botanical|orchid/],
        ['celtic/norse', /celtic|viking|norse|odin|dragon|knot|yggdrasil|kraken/],
        ['western', /cowboy|western|horse|saddle|rodeo|cattle|longhorn/],
        ['nautical', /anchor|ship|nautical|sea|ocean|lighthouse|whale|turtle/],
        ['holiday', /christmas|halloween|easter|santa|pumpkin|ornament|snow/],
        ['trays/functional', /tray|bowl|coaster|sign|hanger|holder|box/],
      ]) if (re.test(title)) s[bucket] = (s[bucket] || 0) + 1;
    }
  }
  if (rows.length < 100) break;
  await new Promise((x) => setTimeout(x, 350));
}

const list = Object.entries(byCountry).sort((a, b) => b[1].usd - a[1].usd);
const total = list.reduce((s, [, v]) => s + v.usd, 0);
console.log(`${receipts} receipts across ${list.length} countries, $${total.toFixed(0)}\n`);
console.log('COUNTRY  ORDERS   REVENUE   SHARE   AVG    TOP SUBJECTS BOUGHT');
for (const [c, v] of list.slice(0, 25)) {
  const s = Object.entries(subjectsByCountry[c] || {}).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`  ${c.padEnd(6)} ${String(v.orders).padStart(6)} $${v.usd.toFixed(0).padStart(8)} ${((100 * v.usd) / total).toFixed(1).padStart(6)}% $${(v.usd / v.orders).toFixed(2).padStart(6)}  ${s}`);
}
fs.writeFileSync('etsy-buyer-countries.json', JSON.stringify({ receipts, byCountry, subjectsByCountry }, null, 1));
console.log('\nwritten to etsy-buyer-countries.json');
