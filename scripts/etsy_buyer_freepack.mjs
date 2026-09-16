// Give the imported Etsy buyers the five free files, with the price gap as
// the reason to look at the site.
//
// WHY THIS SHAPE. 2,054 Etsy buyers are on the list and 5 have ever bought
// here. Selling to them cold converts at 0.30%; people who took the free pack
// convert at 13.2%. So this does not sell: it hands over the free pack, which
// is the step that actually works, and explains the price difference honestly
// (98% of designs are cheaper here, about 20%, because Etsy takes a quarter).
//
// Each person gets a PERMANENT stored key (subscribers.free_pack_token) rather
// than a signed link, because signed links broke once when the signing secret
// differed between the signer and the verifier. The key is minted once and
// reused, so re-running never invalidates a link someone already has.
//
// Dry run by default.
//   node scripts/etsy_buyer_freepack.mjs                     # who, and the copy
//   node scripts/etsy_buyer_freepack.mjs --test you@you.com  # one real email
//   node scripts/etsy_buyer_freepack.mjs --apply --limit 200 # send a wave
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { etsyBuyerFreePackEmail, send as sendEmail } from '../.digest_send/etsy_freepack.mjs';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const TEST = args.includes('--test') ? args[args.indexOf('--test') + 1] : null;
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 0;
const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const KIND = 'etsy-freepack';

const lc = (s) => String(s || '').trim().toLowerCase();
const isJunk = (e) => /^claude-|^deploycheck@|@example\.(invalid|com|test)$/i.test(e);

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

// The pack itself. Refuse to offer a pack that is not there.
const { data: gs } = await db.from('growth_settings').select('free_pack_url').eq('id', 1).maybeSingle();
if (!gs?.free_pack_url) { console.error('growth_settings.free_pack_url is empty - nothing to give away'); process.exit(1); }

// The price gap, measured now rather than typed.
const prods = await all('products', 'price_usd,etsy_listing_id,title,slug,image_url,created_at', (q) => q.eq('active', true));
const stats = await all('etsy_listing_stats', 'listing_id,price_usd');
const etsyPrice = Object.fromEntries(stats.map((s) => [String(s.listing_id), Number(s.price_usd)]));
const pairs = prods.filter((p) => p.etsy_listing_id)
  .map((p) => ({ w: Number(p.price_usd), e: etsyPrice[String(p.etsy_listing_id)] }))
  .filter((x) => x.w > 0 && x.e > 0);
const cheaper = pairs.filter((x) => x.w < x.e);
const gap = cheaper.length ? {
  count: cheaper.length,
  pct: cheaper.reduce((a, b) => a + (1 - b.w / b.e), 0) / cheaper.length * 100,
  avg: cheaper.reduce((a, b) => a + (b.e - b.w), 0) / cheaper.length,
} : null;

// Three recent designs to show, newest first.
const picks = [...prods].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3)
  .map((p) => ({ slug: p.slug, title: p.title, image_url: p.image_url, price_usd: Number(p.price_usd) }));

// ── audience ───────────────────────────────────────────────────────────
const sent = new Set((await all('email_send_log', 'recipient,kind,status', (q) => q.eq('kind', KIND).eq('status', 'sent'))).map((r) => lc(r.recipient)));
const people = await all('subscribers', 'email,name,source,confirmed_at,unsubscribed_at,suppressed_at,free_pack_token');
const todoAll = people.filter((p) => {
  const e = lc(p.email);
  if (!e || isJunk(e)) return false;
  if (!/^etsy/i.test(p.source || '')) return false;        // this campaign is only for them
  if (!p.confirmed_at) return false;
  if (p.unsubscribed_at || p.suppressed_at) return false;
  if (sent.has(e)) return false;                            // never twice
  return true;
});
const todo = LIMIT ? todoAll.slice(0, LIMIT) : todoAll;

// What each person actually bought, so the opening line is true.
const bought = {};
for (const t of ['etsy_buyers', 'etsy_receipt_items']) {
  try {
    const rows = await all(t, '*');
    for (const r of rows) {
      const e = lc(r.email || r.buyer_email);
      if (e && !bought[e] && (r.title || r.listing_title)) bought[e] = r.title || r.listing_title;
    }
    if (Object.keys(bought).length) break;
  } catch { /* table may not exist; the copy works without it */ }
}

console.log(`pack    : ${gs.free_pack_url.slice(0, 60)}`);
if (gap) console.log(`gap     : ${gap.count} designs cheaper here, avg $${gap.avg.toFixed(2)} (${gap.pct.toFixed(0)}% off)`);
console.log(`audience: ${todoAll.length} etsy buyers not yet sent${LIMIT ? `, sending ${todo.length} this wave` : ''}`);
console.log(`          (${Object.keys(bought).length} of them we can name a design for)`);

const build = (p, key) => etsyBuyerFreePackEmail({
  email: p.email, name: p.name,
  filesUrl: `${SITE}/free/files?k=${encodeURIComponent(key)}`,
  boughtTitle: bought[lc(p.email)] || null,
  cheaperCount: gap?.count ?? null, cheaperPct: gap?.pct ?? null, avgSaving: gap?.avg ?? null,
  picks,
});

if (TEST) {
  const m = build({ email: TEST, name: null }, 'TEST-KEY-NOT-REAL');
  const r = await sendEmail({ to: TEST, subject: m.subject, html: m.html, text: m.text, tags: [{ name: 'kind', value: KIND }] });
  console.log('\ntest sent:', TEST, JSON.stringify(r).slice(0, 120));
  process.exit(0);
}
if (!APPLY) {
  const m = build(todo[0] || { email: 'someone@example.com' }, '<key>');
  console.log(`\nsubject: ${m.subject}\n\n${m.text}\n`);
  console.log('DRY RUN. Add --apply (and --limit N for a wave) to send.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const p of todo) {
  try {
    let key = p.free_pack_token;
    if (!key) {
      key = randomBytes(24).toString('base64url');
      const { error } = await db.from('subscribers').update({ free_pack_token: key }).eq('email', p.email);
      if (error) throw new Error(`could not store key: ${error.message}`);
    }
    const m = build(p, key);
    const r = await sendEmail({
      to: p.email, subject: m.subject, html: m.html, text: m.text,
      idempotencyKey: `etsy-freepack:${lc(p.email)}`,
      tags: [{ name: 'kind', value: KIND }],
    });
    if (r?.quota) { console.log('stopping: daily email quota reached, run again tomorrow'); break; }
    ok++;
    if (ok % 50 === 0) console.log(`  ${ok} sent…`);
  } catch (e) { fail++; console.error('  failed', p.email, String(e.message).slice(0, 80)); }
  await new Promise((r) => setTimeout(r, 600));
}
console.log(`\nsent ${ok}, failed ${fail}`);
