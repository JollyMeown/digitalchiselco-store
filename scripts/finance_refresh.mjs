// Finance dashboard refresh — pulls money data from every channel and writes
// daily aggregates + a status row to Supabase (finance_daily / finance_status).
// Runs where the Etsy OAuth token lives (locally, like the Cults3D engine); the
// deployed admin dashboard just reads the cached tables.
//
//   node scripts/finance_refresh.mjs [--months 13]
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const args = process.argv.slice(2);
const MONTHS = Number((args[args.indexOf('--months') + 1]) || 13);
const EUR_USD = Number(process.env.EUR_USD_RATE || 1.08);
const SHOP = 61524055;
const CULTS_USER = process.env.CULTS3D_USERNAME;
const CULTS_KEY = process.env.CULTS3D_API_KEY;

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const round2 = (n) => Math.round(n * 100) / 100;
const dayOf = (unixOrIso) => (typeof unixOrIso === 'number' ? new Date(unixOrIso * 1000) : new Date(unixOrIso)).toISOString().slice(0, 10);

// daily[`${day}|${channel}`] = { revenue_usd, ad_spend_usd, fees_usd, revenue_native, currency }
const daily = new Map();
function bump(day, channel, patch) {
  const k = `${day}|${channel}`;
  const cur = daily.get(k) || { revenue_usd: 0, ad_spend_usd: 0, fees_usd: 0, revenue_native: 0, currency: patch.currency || 'USD' };
  cur.revenue_usd += patch.revenue_usd || 0;
  cur.ad_spend_usd += patch.ad_spend_usd || 0;
  cur.fees_usd += patch.fees_usd || 0;
  cur.revenue_native += patch.revenue_native || 0;
  if (patch.currency) cur.currency = patch.currency;
  daily.set(k, cur);
}

const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - MONTHS);
const cutoffMs = cutoff.getTime();
const status = { channels: {}, generated_note: 'Etsy revenue = receipt grandtotal; Etsy ad spend = Promoted Listings (prolist); Cults converted at EUR_USD=' + EUR_USD };

// ── 1) WEBSITE (Paddle orders — mostly USD; multi-currency checkout can
// store EUR/GBP/CAD/AUD totals, converted here with the stored fx rates) ──
{
  let from = 0, count = 0, rev30 = 0;
  const now = Date.now(), d30 = now - 30 * 86400000;
  // fx_rates = USD→foreign, refreshed daily by the growth cron. foreign→USD = /rate.
  let fx = {};
  try {
    const { data: st } = await db.from('site_settings').select('fx_rates').eq('id', 1).maybeSingle();
    fx = st?.fx_rates || {};
  } catch { /* fall back: non-USD orders counted at face value */ }
  const toUsd = (amount, ccy) => {
    if (!ccy || ccy === 'USD') return amount;
    const r = Number(fx[ccy]);
    return r > 0 ? amount / r : amount;
  };
  for (;;) {
    const { data } = await db.from('orders').select('total, currency, status, created_at').eq('status', 'paid').gte('created_at', cutoff.toISOString()).order('created_at').range(from, from + 999);
    if (!data || !data.length) break;
    for (const o of data) {
      const day = o.created_at.slice(0, 10);
      const usd = round2(toUsd(Number(o.total) || 0, o.currency));
      bump(day, 'website', { revenue_usd: usd, revenue_native: usd, currency: 'USD' });
      count++;
      if (new Date(o.created_at).getTime() >= d30) rev30 += usd;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  status.channels.website = { currency: 'USD', orders: count, revenue_30d: round2(rev30) };
  console.log(`website: ${count} paid orders`);
}

// A channel either refreshes completely or not at all.
//
// From March to September 2026 this script wrote Etsy fees and ad spend while
// the receipts call was timing out (the PC's VPN cannot reach openapi.etsy.com),
// so the dashboard showed Etsy at a loss of $5,772 for six months. The fix is
// not to hide the failure but to refuse to publish half a picture: a channel
// whose fetch failed keeps its previous rows and is marked stale, and the
// Finance tab says so in red instead of showing a confident wrong number.
const channelOk = { website: true, etsy: true, cults: true };
const channelError = {};
const failChannel = (ch, why) => { channelOk[ch] = false; channelError[ch] = String(why).slice(0, 160); };

// Etsy calls retried: a dropped connection is common from this machine and is
// not a reason to declare the shop broke.
async function etsyRetry(path) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try { return await etsy(path, { oauth: true }); }
    catch (e) { last = e; if (i < 3) await new Promise((r) => setTimeout(r, i * 3000)); }
  }
  throw last;
}

// ── 2) ETSY — receipts (revenue) + ledger (ad spend / fees / payouts / balance) ──
{
  // revenue from receipts
  let rev = 0, receipts = 0;
  for (let offset = 0; offset < 20000; offset += 100) {
    let page;
    try { page = await etsyRetry(`/shops/${SHOP}/receipts?limit=100&offset=${offset}`); }
    catch (e) { console.log('etsy receipts FAILED:', e.message.slice(0, 80)); failChannel('etsy', 'receipts: ' + e.message); break; }
    const rows = page.results || [];
    if (!rows.length) break;
    let oldestInPage = Infinity;
    for (const r of rows) {
      const ts = (r.created_timestamp || r.create_timestamp) * 1000;
      oldestInPage = Math.min(oldestInPage, ts);
      if (ts < cutoffMs) continue;
      const gt = r.grandtotal || r.total_price;
      const usd = gt ? Number(gt.amount) / Number(gt.divisor || 100) : 0;
      bump(dayOf(Math.floor(ts / 1000)), 'etsy', { revenue_usd: usd, revenue_native: usd, currency: gt?.currency_code || 'USD' });
      rev += usd; receipts++;
    }
    if (rows.length < 100 || oldestInPage < cutoffMs) break;
  }
  console.log(`etsy: ${receipts} receipts, $${round2(rev)} gross`);

  // ledger — month-chunked (31-day cap). ad spend (prolist), fees, payouts, balance.
  const FEE_TYPES = new Set(['transaction', 'PAYMENT_PROCESSING_FEE', 'listing', 'vat_tax_ep', 'sales_tax', 'renew_sold_auto', 'renew_option', 'auto_renew_expired']);
  let adTotal = 0, feeTotal = 0, balanceCents = null, balanceAt = 0, lastPayout = null;
  const nowSec = Math.floor(Date.now() / 1000);
  const cutSec = Math.floor(cutoffMs / 1000);
  for (let end = nowSec; end > cutSec;) {
    const start = Math.max(cutSec, end - 2678000);
    for (let offset = 0; offset < 100000; offset += 100) {
      let page;
      try { page = await etsyRetry(`/shops/${SHOP}/payment-account/ledger-entries?min_created=${start}&max_created=${end}&limit=100&offset=${offset}`); }
      catch (e) { console.log('etsy ledger FAILED:', e.message.slice(0, 80)); failChannel('etsy', 'ledger: ' + e.message); break; }
      const rows = page.results || [];
      if (!rows.length) break;
      for (const e of rows) {
        const cents = Number(e.amount) || 0;
        const type = e.ledger_type || e.entry_type || '';
        const day = dayOf(Number(e.create_date || e.created_timestamp));
        if (e.balance != null && (e.create_date || 0) > balanceAt) { balanceCents = Number(e.balance); balanceAt = e.create_date; }
        if (type === 'prolist') { const usd = Math.abs(cents) / 100; adTotal += usd; bump(day, 'etsy', { ad_spend_usd: usd, currency: 'USD' }); }
        else if (type === 'DISBURSE2' || type === 'DISBURSE') { const usd = Math.abs(cents) / 100; if (!lastPayout || (e.create_date || 0) > lastPayout.at) lastPayout = { at: e.create_date, amount: usd, date: day }; }
        else if (FEE_TYPES.has(type)) { const usd = Math.abs(cents) / 100; feeTotal += usd; bump(day, 'etsy', { fees_usd: usd, currency: 'USD' }); }
      }
      if (rows.length < 100) break;
    }
    end = start - 1;
  }
  // estimate next payout: Etsy deposits on a schedule; approximate 7 days after the last.
  const nextEst = lastPayout ? new Date(lastPayout.at * 1000 + 7 * 86400000).toISOString().slice(0, 10) : null;
  status.channels.etsy = {
    currency: 'USD', revenue_365d: round2(rev), receipts,
    ad_spend: round2(adTotal), fees: round2(feeTotal),
    balance: balanceCents != null ? round2(balanceCents / 100) : null,
    last_payout: lastPayout ? { date: lastPayout.date, amount: round2(lastPayout.amount) } : null,
    next_payout_est: nextEst,
  };
  console.log(`etsy: ad spend $${round2(adTotal)}, fees $${round2(feeTotal)}, balance $${balanceCents != null ? round2(balanceCents / 100) : '?'}`);
}

// ── 3) CULTS3D — sales (EUR → USD) ───────────────────────────────────
if (CULTS_USER && CULTS_KEY) try {
  const auth = 'Basic ' + Buffer.from(`${CULTS_USER}:${CULTS_KEY}`).toString('base64');
  const gql = async (q) => (await fetch('https://cults3d.com/graphql', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify({ query: q }) })).json();
  const sales = [];
  for (let offset = 0; offset < 20000; offset += 100) {
    const d = await gql(`{ myself { salesBatch(limit:100, offset:${offset}){ results { createdAt payedOutAt income { value currency } } } } }`);
    const batch = d.data?.myself?.salesBatch?.results || [];
    sales.push(...batch);
    if (batch.length < 100) break;
  }
  let rev = 0, pending = 0, available = 0;
  const now = Date.now(), verify = 30 * 86400000;
  for (const s of sales) {
    const val = Number(s.income?.value) || 0;         // EUR
    const day = dayOf(s.createdAt);
    if (new Date(s.createdAt).getTime() >= cutoffMs) { bump(day, 'cults', { revenue_usd: val * EUR_USD, revenue_native: val, currency: s.income?.currency || 'EUR' }); rev += val; }
    if (!s.payedOutAt) { pending += val; if (now - new Date(s.createdAt).getTime() > verify) available += val; }
  }
  const nowD = new Date();
  const nextEst = pending > 0 ? new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + (nowD.getUTCDate() >= 15 ? 1 : 0), 15)).toISOString().slice(0, 10) : null;
  status.channels.cults = { currency: 'EUR', eur_usd: EUR_USD, revenue_365d: round2(rev), pending: round2(pending), available: round2(available), next_payout_est: nextEst, payout_url: 'https://cults3d.com/en/sales' };
  console.log(`cults: ${sales.length} sales, €${round2(rev)} in window, pending €${round2(pending)}, available €${round2(available)}`);
} catch (e) {
  console.log('cults FAILED:', String(e?.message || e).slice(0, 80));
  failChannel('cults', e?.message || e);
} else {
  console.log('cults: skipped (no CULTS3D creds)');
}

// ── write finance_daily (replace the window) + finance_status ────────
// Only channels that refreshed completely are rewritten. A failed channel keeps
// whatever rows it had, and its status carries the error and the moment of the
// last good sync, so the tab can show "stale since" instead of a wrong total.
const okChannels = Object.keys(channelOk).filter((c) => channelOk[c]);
const rows = [...daily.entries()]
  .map(([k, v]) => { const [day, channel] = k.split('|'); return { day, channel, revenue_usd: round2(v.revenue_usd), ad_spend_usd: round2(v.ad_spend_usd), fees_usd: round2(v.fees_usd), revenue_native: round2(v.revenue_native), currency: v.currency }; })
  .filter((r) => channelOk[r.channel]);
if (okChannels.length) {
  await db.from('finance_daily').delete().gte('day', cutoff.toISOString().slice(0, 10)).in('channel', okChannels);
  for (let i = 0; i < rows.length; i += 500) { const { error } = await db.from('finance_daily').upsert(rows.slice(i, i + 500), { onConflict: 'day,channel' }); if (error) throw error; }
}
const { data: prevStatus } = await db.from('finance_status').select('data, synced_at').eq('id', 1).maybeSingle();
const prev = prevStatus?.data?.channels || {};
const nowIso = new Date().toISOString();
for (const c of Object.keys(channelOk)) {
  if (channelOk[c]) {
    status.channels[c] = { ...(status.channels[c] || {}), ok: true, error: null, last_good_sync: nowIso };
  } else {
    // keep the last good numbers, mark them stale, say why
    status.channels[c] = { ...(prev[c] || {}), ok: false, error: channelError[c], last_good_sync: prev[c]?.last_good_sync || null };
  }
}
await db.from('finance_status').update({ data: status, synced_at: nowIso }).eq('id', 1);
console.log(`\n✓ wrote ${rows.length} finance_daily rows for [${okChannels.join(', ')}]${okChannels.length < 3 ? ' — FAILED: ' + Object.keys(channelOk).filter((c) => !channelOk[c]).map((c) => c + ' (' + channelError[c] + ')').join('; ') : ''}`);
if (okChannels.length < Object.keys(channelOk).length) process.exitCode = 2;

// Weekly (Mondays, UTC): rebuild "frequently bought together" from Etsy
// receipts + website orders. Needs the same local Etsy token, which is why it
// rides on this task. A failure here never touches the finance numbers above.
if (new Date().getUTCDay() === 1 && channelOk.etsy) {
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(process.execPath, ['scripts/build_product_pairs.mjs', '--apply'], { encoding: 'utf8', timeout: 15 * 60e3 });
    console.log('pairs:', out.trim().split('\n').pop());
  } catch (e) { console.log('pairs rebuild failed (finance unaffected):', String(e.message).slice(0, 120)); }
}
