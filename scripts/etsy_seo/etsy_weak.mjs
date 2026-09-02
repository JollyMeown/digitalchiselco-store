// Build the "weak listings" dataset for the Etsy SEO pass:
//   views (from etsy_listing_stats) + SALES per listing (from Etsy receipts,
//   which no table holds yet) + tags for a winners-vs-losers comparison.
// One script, sequential, because Etsy ROTATES the refresh token on every
// refresh: two scripts refreshing at once would race and break the token.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const S = fileURLToPath(new URL('.', import.meta.url)).replace(/[\/]$/, '');
import { etsy, getAccessToken } from 'file:///D:/000%20DIGITAL%20CHISEL%20WEBSITE/scripts/etsy_client.mjs';

const OUT = `${S}/etsy_weak.json`;
const env = fs.readFileSync('D:/000 DIGITAL CHISEL WEBSITE/.env', 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const H = { apikey: g('SUPABASE_SERVICE_ROLE_KEY'), authorization: 'Bearer ' + g('SUPABASE_SERVICE_ROLE_KEY') };
const U = g('PUBLIC_SUPABASE_URL');

const tok = await getAccessToken();
if (!tok) { console.error('NO ETSY TOKEN — run scripts/etsy_oauth.mjs'); process.exit(1); }
const me = await etsy('/users/me', { oauth: true });
const shopId = me.shop_id;
console.log('etsy auth ok, shop_id', shopId);

// 1. sales per listing from receipts (last 365 days)
const since = Math.floor((Date.now() - 365 * 864e5) / 1000);
const sales = {}; let offset = 0, receipts = 0;
for (;;) {
  const r = await etsy(`/shops/${shopId}/receipts?limit=100&offset=${offset}&min_created=${since}`, { oauth: true });
  const list = r.results || [];
  for (const rc of list) { receipts++; for (const t of rc.transactions || []) sales[t.listing_id] = (sales[t.listing_id] || 0) + (t.quantity || 1); }
  if (list.length < 100) break;
  offset += 100;
  if (offset > 5000) break;
}
console.log('receipts (365d):', receipts, '| listings with >=1 sale:', Object.keys(sales).length);

// 2. views from DB
const stats = [];
for (let off = 0; ; off += 1000) {
  const p = await fetch(`${U}/rest/v1/etsy_listing_stats?select=listing_id,title,views,favorers&order=views.desc&limit=1000&offset=${off}`, { headers: H }).then((r) => r.json());
  if (!p.length) break; stats.push(...p); if (p.length < 1000) break;
}
const rows = stats.map((s) => ({ ...s, sales: sales[s.listing_id] || 0 }));
const weak = rows.filter((r) => r.views < 20 && r.sales === 0);
const winners = rows.filter((r) => r.sales >= 3).sort((a, b) => b.sales - a.sales);
console.log('listings:', rows.length, '| WEAK (views<20 & 0 sales):', weak.length, '| winners (3+ sales):', winners.length);

// 3. tags for a winners/losers sample (sequential, polite)
const sample = async (ids) => {
  const out = [];
  for (const id of ids) {
    try { const l = await etsy(`/listings/${id}`, { oauth: true }); out.push({ id, title: l.title, tags: l.tags || [], views: l.views, sales: sales[id] || 0 }); }
    catch (e) { console.error('listing', id, e.message.slice(0, 80)); }
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
};
const winSample = await sample(winners.slice(0, 25).map((w) => w.listing_id));
const weakSample = await sample(weak.slice(0, 25).map((w) => w.listing_id));

const tagFreq = (arr) => { const f = {}; for (const l of arr) for (const t of l.tags) f[t.toLowerCase()] = (f[t.toLowerCase()] || 0) + 1; return Object.entries(f).sort((a, b) => b[1] - a[1]); };
console.log('\nWINNER TAGS (top 20):', tagFreq(winSample).slice(0, 20).map(([t, n]) => `${t}(${n})`).join(', '));
console.log('\nWEAK TAGS (top 20):', tagFreq(weakSample).slice(0, 20).map(([t, n]) => `${t}(${n})`).join(', '));
console.log('\navg tag count — winners:', (winSample.reduce((a, l) => a + l.tags.length, 0) / Math.max(1, winSample.length)).toFixed(1), '| weak:', (weakSample.reduce((a, l) => a + l.tags.length, 0) / Math.max(1, weakSample.length)).toFixed(1));
console.log('\nTOP SELLERS:'); winners.slice(0, 10).forEach((w) => console.log('  ', String(w.sales).padStart(3), 'sales', String(w.views).padStart(5), 'v |', w.title.slice(0, 70)));

fs.writeFileSync(OUT, JSON.stringify({ shopId, weak, winners: winners.slice(0, 100), winSample, weakSample, totalListings: rows.length }, null, 1));
console.log('\nsaved', OUT);
