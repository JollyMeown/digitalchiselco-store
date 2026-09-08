// Feeds the Advertisement dashboard. Runs LOCALLY (this machine holds the Etsy
// OAuth token), wired into scripts/run_finance_refresh.cmd after the listing
// stats sync.
//
// Three jobs:
//   1. ORDER HOURS  every receipt's timestamp, bucketed by hour in the shop's
//      timezone and the owner's, so ad scheduling can follow real demand.
//   2. LISTING HISTORY  a daily snapshot of each listing's views, which is the
//      only way to tell a listing being advertised NOW from one that was
//      popular a year ago. Etsy publishes no per-listing ad spend.
//   3. PROLIST CHARGES  the real daily Promoted Listings charge from the
//      payment ledger, which confirms the ad spend in finance_daily.
//
//   node scripts/etsy_ads_sync.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TZS = ['America/Los_Angeles', 'Asia/Karachi'];
const today = new Date().toISOString().slice(0, 10);

const me = await etsy('/users/me', { oauth: true });
const shop = me.shop_id;

// ── 1. order hours ───────────────────────────────────────────────────
const receipts = [];
for (let off = 0; off < 8000; off += 100) {
  const r = await etsy(`/shops/${shop}/receipts?limit=100&offset=${off}&sort_on=created&sort_order=desc`, { oauth: true });
  for (const rc of r.results || []) {
    receipts.push({ t: rc.created_timestamp * 1000, total: Number(rc.grandtotal?.amount || 0) / (rc.grandtotal?.divisor || 100) });
  }
  if ((r.results || []).length < 100) break;
}
const span = receipts.length ? Math.max(1, Math.round((Date.now() - Math.min(...receipts.map((r) => r.t))) / 86400000)) : 0;
console.log(`receipts: ${receipts.length} over ${span} days`);
const rows = [];
for (const tz of TZS) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
  const orders = Array(24).fill(0), rev = Array(24).fill(0);
  for (const r of receipts) { const h = Number(fmt.format(new Date(r.t))) % 24; orders[h]++; rev[h] += r.total; }
  for (let h = 0; h < 24; h++) rows.push({ hour: h, tz, orders: orders[h], revenue_usd: +rev[h].toFixed(2), sample_days: span, updated_at: new Date().toISOString() });
}
{
  const { error } = await db.from('etsy_order_hours').upsert(rows, { onConflict: 'hour,tz' });
  console.log(error ? `order hours FAILED: ${error.message}` : `order hours stored for ${TZS.length} timezones`);
}

// ── 2. listing view snapshot ─────────────────────────────────────────
const listings = [];
for (let off = 0; off < 6000; off += 100) {
  // the authenticated shop-listings route; /listings/active is the anonymous
  // one and refuses an offset past 100
  const r = await etsy(`/shops/${shop}/listings?state=active&limit=100&offset=${off}`, { oauth: true });
  for (const l of r.results || []) listings.push({ listing_id: l.listing_id, day: today, views: Number(l.views) || 0, favorers: Number(l.num_favorers) || 0 });
  if ((r.results || []).length < 100) break;
}
let snap = 0;
for (let i = 0; i < listings.length; i += 500) {
  const { error } = await db.from('etsy_listing_history').upsert(listings.slice(i, i + 500), { onConflict: 'listing_id,day' });
  if (!error) snap += Math.min(500, listings.length - i); else console.error('history:', error.message);
}
console.log(`listing view snapshot: ${snap} listings for ${today}`);

// ── 3. Promoted Listings charges from the payment ledger ─────────────
// The API caps each query at 31 days, so walk backwards in 30-day windows.
const DAY = 86400;
const seen = new Set(), pro = [];
for (let back = 0; back < 180; back += 30) {
  const max = Math.floor(Date.now() / 1000) - back * DAY;
  const min = max - 30 * DAY;
  for (let off = 0; off < 6000; off += 100) {
    let r;
    try { r = await etsy(`/shops/${shop}/payment-account/ledger-entries?min_created=${min}&max_created=${max}&limit=100&offset=${off}`, { oauth: true }); }
    catch (e) { console.error('ledger window failed:', String(e.message).slice(0, 90)); break; }
    for (const e of r.results || []) {
      if (seen.has(e.entry_id)) continue;
      seen.add(e.entry_id);
      if (/prolist/i.test(e.ledger_type || '')) pro.push({ day: new Date(e.created_timestamp * 1000).toISOString().slice(0, 10), amount: Math.abs(Number(e.amount || 0)) / 100 });
    }
    if ((r.results || []).length < 100) break;
  }
}
const byDay = {};
for (const p of pro) byDay[p.day] = (byDay[p.day] || 0) + p.amount;
const days = Object.keys(byDay).sort();
console.log(`prolist charges: ${pro.length} entries over ${days.length} days, $${Object.values(byDay).reduce((a, b) => a + b, 0).toFixed(2)}`);
if (days.length) console.log(`  latest: ${days.slice(-5).map((d) => `${d} $${byDay[d].toFixed(2)}`).join(' | ')}`);
