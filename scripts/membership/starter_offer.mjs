// Send the starter-bundle offer (6 hand-picked designs for $6.99).
//
// It delivers its OWN fixed bundle (monthly_files month = 0001-01), never a
// calendar month's member pack, so nothing a paying member bought is given
// away cheaper. The script refuses to run until that bundle has a link.
//
// WHO MUST NEVER RECEIVE IT (owner, 2026-09-16: "this September pack is also
// used by paid members, so do not send to paid members"):
//   1. anyone who has EVER had a member_subscriptions row, at any status.
//      An active member would see a cheaper route to the pack they already
//      paid for. An expired member must get the win-back (COMEBACK15), not a
//      price that teaches them to let terms lapse.
//   2. anyone holding a membership order that has not yet become a term
//      (belt and braces against a webhook that has not landed).
//   3. unsubscribed, suppressed or junk rows.
//   4. imported Etsy buyers. They convert at 0.30% cold; the free pack
//      converts at 13.2%. They get the free pack first, not this.
//
// WHO DOES receive it, in priority order:
//   buyer     - bought singles on the website, no membership. Warmest.
//   free-pack - took the five free files, never bought.
//
// The Etsy price gap in the email is measured from the catalogue on each run,
// so it can never drift away from the truth.
//
// Dry run by default. Nothing sends without --apply.
//   node scripts/membership/starter_offer.mjs                    # who would get it
//   node scripts/membership/starter_offer.mjs --test you@you.com # one real email
//   node scripts/membership/starter_offer.mjs --group buyer --apply
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { starterMonthEmail, send as sendEmail } from '../../.digest_send/starter_offer.mjs';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const TEST = args.includes('--test') ? args[args.indexOf('--test') + 1] : null;
const GROUP = (args[args.indexOf('--group') + 1] || 'both').toLowerCase();
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 0;

const KIND = 'membership-offer';
const lc = (s) => String(s || '').trim().toLowerCase();
const isJunk = (e) => /^claude-|^deploycheck@|@example\.(invalid|com|test)$/i.test(e);

// Page past PostgREST's silent 1000-row cap.
async function all(table, select, apply = (q) => q) {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await apply(db.from(table).select(select)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
    from += 1000;
  }
  return out;
}

// ── the offer itself ───────────────────────────────────────────────────
const { data: plan } = await db.from('membership_plans')
  .select('slug,name,price_usd,files_per_month,original_price_usd').eq('slug', 'starter-month').maybeSingle();
if (!plan) { console.error('no starter-month plan row; run migration 132'); process.exit(1); }
const { data: up } = await db.from('membership_plans')
  .select('price_usd,months,files_per_month').eq('slug', '3-month').maybeSingle();

// The starter bundle is its own fixed row, never a member month (owner rule
// 2026-09-16: the packs members paid for stay theirs).
const STARTER_PACK_MONTH = '0001-01';
const { data: pack } = await db.from('monthly_files')
  .select('month,title,cover_image_url,items,standard_drive_link').eq('month', STARTER_PACK_MONTH).maybeSingle();
if (!pack) { console.error('no starter bundle row (monthly_files month=0001-01) - build it first'); process.exit(1); }
if (!pack.standard_drive_link) { console.error('the starter bundle row has no download link yet - nothing to deliver, refusing to offer it'); process.exit(1); }
const packItems = (Array.isArray(pack.items) ? pack.items : []).slice(0, 3)
  .map((i) => ({ slug: i.slug, title: i.title, image_url: i.image_url, price_usd: null }));

// ── exclusions ─────────────────────────────────────────────────────────
const subs = await all('member_subscriptions', 'email,status');
const everMember = new Set(subs.map((s) => lc(s.email)));

const orders = await all('orders', 'id,email,status,deleted_at', (q) => q.eq('status', 'paid').is('deleted_at', null));
const paidIds = orders.map((o) => o.id);
const items = [];
for (let i = 0; i < paidIds.length; i += 200) {
  const { data } = await db.from('order_items').select('order_id,title,price_usd,qty').in('order_id', paidIds.slice(i, i + 200));
  items.push(...(data || []));
}
const memRe = /membership|month\s*premium/i;
const orderById = Object.fromEntries(orders.map((o) => [o.id, o]));
for (const it of items) if (memRe.test(it.title || '')) everMember.add(lc(orderById[it.order_id]?.email));

// spend per buyer, for the opening line
const spend = {};
for (const o of orders) {
  const e = lc(o.email); if (!e) continue;
  spend[e] = spend[e] || { spent: 0, designs: 0 };
}
for (const it of items) {
  const e = lc(orderById[it.order_id]?.email); if (!e || !spend[e]) continue;
  if (memRe.test(it.title || '')) continue;
  spend[e].spent += Number(it.price_usd || 0) * (it.qty || 1);
  spend[e].designs += (it.qty || 1);
}

// Already offered? The ledger is the record, so a second run can never
// double-send, whatever flags it is given.
const already = new Set(
  (await all('email_send_log', 'recipient,kind,status', (q) => q.eq('kind', KIND).eq('status', 'sent')))
    .map((r) => lc(r.recipient)),
);

const people = await all('subscribers', 'email,name,source,confirmed_at,unsubscribed_at,suppressed_at');
const eligible = people.filter((p) => {
  const e = lc(p.email);
  if (!e || isJunk(e)) return false;
  if (p.unsubscribed_at || p.suppressed_at) return false;
  if (!p.confirmed_at) return false;
  if (everMember.has(e)) return false;                 // rule 1 and 2
  if (/^etsy/i.test(p.source || '')) return false;     // rule 4
  if (already.has(e)) return false;                    // offered once already
  return true;
});

const buyers = eligible.filter((p) => spend[lc(p.email)]?.designs > 0);
const freePack = eligible.filter((p) => p.source === 'free-pack' && !(spend[lc(p.email)]?.designs > 0));
let todo = GROUP === 'buyer' ? buyers : GROUP === 'free-pack' ? freePack : [...buyers, ...freePack];
if (LIMIT) todo = todo.slice(0, LIMIT);

// The Etsy-versus-here saving, measured from the catalogue rather than typed.
const prods = await all('products', 'price_usd,etsy_listing_id', (q) => q.eq('active', true).not('etsy_listing_id', 'is', null));
const stats = await all('etsy_listing_stats', 'listing_id,price_usd');
const etsyPrice = Object.fromEntries(stats.map((s) => [String(s.listing_id), Number(s.price_usd)]));
const pairs = prods.map((p) => ({ w: Number(p.price_usd), e: etsyPrice[String(p.etsy_listing_id)] })).filter((x) => x.w > 0 && x.e > 0);
const cheaper = pairs.filter((x) => x.w < x.e);
const etsy = cheaper.length ? {
  count: cheaper.length,
  pct: cheaper.reduce((a, b) => a + (1 - b.w / b.e), 0) / cheaper.length * 100,
  avg: cheaper.reduce((a, b) => a + (b.e - b.w), 0) / cheaper.length,
} : null;

console.log(`offer   : ${plan.name} $${plan.price_usd} for ${plan.files_per_month} designs`);
console.log(`bundle  : "${pack.title || '(untitled)'}" with ${(pack.items || []).length} designs listed`);
if (etsy) console.log(`etsy    : ${etsy.count} designs cheaper here, avg $${etsy.avg.toFixed(2)} less (${etsy.pct.toFixed(0)}% off)`);
console.log(`excluded: ${everMember.size} people who have or had a membership, all etsy imports, unconfirmed and unsubscribed`);
console.log(`audience: ${buyers.length} website buyers + ${freePack.length} free-pack subscribers = ${todo.length} to send\n`);
for (const p of todo.slice(0, 12)) {
  const s = spend[lc(p.email)];
  console.log(`  ${(s?.designs ? 'buyer    ' : 'free-pack')}  ${p.email.padEnd(34)}${s?.designs ? `${s.designs} designs, $${s.spent.toFixed(2)}` : ''}`);
}
if (todo.length > 12) console.log(`  … and ${todo.length - 12} more`);

const build = (p) => {
  const s = spend[lc(p.email)];
  return starterMonthEmail({
    email: p.email, name: p.name,
    reason: s?.designs ? 'buyer' : p.source === 'free-pack' ? 'free-pack' : 'browser',
    spent: s?.spent, designs: s?.designs,
    price: Number(plan.price_usd), files: Number(plan.files_per_month) || 6,
    retail: plan.original_price_usd ? Number(plan.original_price_usd) : null,
    packCover: pack.cover_image_url, packItems,
    upgradePrice: up ? Number(up.price_usd) : null,
    upgradeFiles: up ? (up.months * (up.files_per_month || 8)) : null,
    etsyCheaperCount: etsy?.count ?? null,
    etsyCheaperPct: etsy?.pct ?? null,
    etsyAvgSaving: etsy?.avg ?? null,
  });
};

if (TEST) {
  const sample = { email: TEST, name: null, source: 'free-pack' };
  const m = build(sample);
  const r = await sendEmail({ to: TEST, subject: m.subject, html: m.html, text: m.text, tags: [{ name: 'kind', value: KIND }] });
  console.log('\ntest sent:', TEST, JSON.stringify(r).slice(0, 120));
  process.exit(0);
}
if (!APPLY) { console.log('\nDRY RUN. Add --apply to send, or --test you@example.com for one.'); process.exit(0); }

let sent = 0, failed = 0;
for (const p of todo) {
  const m = build(p);
  try {
    const r = await sendEmail({
      to: p.email, subject: m.subject, html: m.html, text: m.text,
      idempotencyKey: `starter-offer:${lc(p.email)}`,
      // `kind` is NOT a top-level send option: it lives in tags, and passing it
      // at the top level is silently ignored. Wave 1 went out that way, which
      // logged 20 rows with a null kind (so the dedupe below could not see
      // them) and dropped the List-Unsubscribe header. Do not "simplify" this.
      tags: [{ name: 'kind', value: KIND }],
    });
    if (r?.quota) { console.log('stopping: daily email quota reached'); break; }
    sent++;
  } catch (e) { failed++; console.error('  failed', p.email, String(e.message).slice(0, 80)); }
  await new Promise((r) => setTimeout(r, 600));
}
console.log(`\nsent ${sent}, failed ${failed}`);
