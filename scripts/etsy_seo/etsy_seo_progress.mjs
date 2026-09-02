// Daily "after" snapshot for the Etsy SEO rewrite experiment.
// Fills views_now / favorers_now / sales_now on every rewritten listing so the
// admin card can show BEFORE -> AFTER for views, favourites and sales. Runs
// locally (this machine holds the Etsy token) after the stats sync; wired into
// scripts/run_finance_refresh.cmd. Never run alongside another Etsy script:
// Etsy rotates the refresh token on every refresh.
import fs from 'node:fs';
import { etsy, getAccessToken } from '../etsy_client.mjs';

const env = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const H = { apikey: g('SUPABASE_SERVICE_ROLE_KEY'), authorization: 'Bearer ' + g('SUPABASE_SERVICE_ROLE_KEY'), 'content-type': 'application/json' };
const U = g('PUBLIC_SUPABASE_URL');

const exp = await fetch(`${U}/rest/v1/etsy_seo_experiment?select=listing_id,applied_at&status=eq.applied`, { headers: H }).then((r) => r.json());
if (!exp.length) { console.log('no rewritten listings yet'); process.exit(0); }

// sales since each listing's apply date, from receipts
if (!(await getAccessToken())) { console.error('no Etsy token'); process.exit(1); }
const me = await etsy('/users/me', { oauth: true });
const earliest = Math.floor(Math.min(...exp.map((e) => Date.parse(e.applied_at))) / 1000) - 3600;
const salesSince = {};
for (let offset = 0; offset <= 5000; offset += 100) {
  const r = await etsy(`/shops/${me.shop_id}/receipts?limit=100&offset=${offset}&min_created=${earliest}`, { oauth: true });
  for (const rc of r.results || []) for (const t of rc.transactions || []) {
    const k = t.listing_id; salesSince[k] = (salesSince[k] || 0) + (t.quantity || 1);
  }
  if ((r.results || []).length < 100) break;
}

const ids = exp.map((e) => e.listing_id);
const stats = [];
for (let i = 0; i < ids.length; i += 200) {
  const p = await fetch(`${U}/rest/v1/etsy_listing_stats?select=listing_id,views,favorers&listing_id=in.(${ids.slice(i, i + 200).join(',')})`, { headers: H }).then((r) => r.json());
  stats.push(...p);
}
const byId = new Map(stats.map((s) => [Number(s.listing_id), s]));
let n = 0;
for (const e of exp) {
  const s = byId.get(Number(e.listing_id));
  const body = { views_now: s?.views ?? null, favorers_now: s?.favorers ?? null, sales_now: salesSince[e.listing_id] || 0, checked_at: new Date().toISOString() };
  const r = await fetch(`${U}/rest/v1/etsy_seo_experiment?listing_id=eq.${e.listing_id}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
  if (r.ok) n++;
}
const totalSales = exp.reduce((a, e) => a + (salesSince[e.listing_id] || 0), 0);
console.log(`progress snapshot: ${n}/${exp.length} listings updated · sales since rewrite: ${totalSales}`);
