// Announce Diamond Select (2026-09-27), same audience split and safety as
// send_cnc_match.mjs:
//   core  free pack, buyers, members, old list: the people who came to us
//   warm  core plus every imported address that has ever opened or clicked
//   cold  never opened anything
//   node --env-file=.env --import tsx scripts/send_diamond_launch.mjs --test
//   node --env-file=.env --import tsx scripts/send_diamond_launch.mjs --audience core
//   node --env-file=.env --import tsx scripts/send_diamond_launch.mjs --audience core --apply
// --apply refuses while the plan is still hidden (the link would land on a page
// without it). Current Diamond members are skipped. Dedupes on diamond-launch:.
import { createClient } from '@supabase/supabase-js';
import { diamondLaunchEmail, unsubHeaders } from '../src/lib/marketing-emails.ts';
import { DIAMOND_SLUG, DIAMOND_CREDITS_PER_MONTH, DIAMOND_GRACE_DAYS, DIAMOND_EXTRA_DISCOUNT, DIAMOND_REGULAR_PRICE, DIAMOND_FOUNDING_UNTIL } from '../src/lib/membership-facts.ts';
import { sendBatch, send as sendOne } from '../src/lib/resend.ts';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const TEST = process.argv.includes('--test');
const AUDIENCE = String(arg('audience', 'core'));
const OPS = 'jolly@digitalchiselco.com';
const COLD_SOURCES = ['etsy-buyer', 'Etsy', 'import'];
const DIRECT = new Set(['free-pack', 'buyer', 'membership', 'custom-ask', 'mailerlite']);

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: plan } = await db.from('membership_plans').select('price_usd, months, available_from, active').eq('slug', DIAMOND_SLUG).single();
const today = new Date().toISOString().slice(0, 10);
const launched = !!plan?.active && (!plan.available_from || String(plan.available_from) <= today);
const founding = today <= DIAMOND_FOUNDING_UNTIL && Number(plan.price_usd) < DIAMOND_REGULAR_PRICE;
const facts = { price: Number(plan.price_usd), months: Number(plan.months), creditsPerMonth: DIAMOND_CREDITS_PER_MONTH, graceDays: DIAMOND_GRACE_DAYS,
  extraDiscount: DIAMOND_EXTRA_DISCOUNT, regularPrice: DIAMOND_REGULAR_PRICE, foundingUntilLabel: '31 December', founding };
const makeEmail = (email, name) => diamondLaunchEmail({ email, name, ...facts });

const page = async (table, select, apply) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(select);
    if (apply) q = apply(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
};

if (TEST) {
  const { subject, html, text } = makeEmail(OPS, 'Jolly');
  const r = await sendOne({
    to: OPS, subject: `[TEST] ${subject}`, html, text, headers: unsubHeaders(OPS),
    idempotencyKey: `diamond-launch-test:${Date.now()}`, tags: [{ name: 'kind', value: 'auth' }],
  });
  console.log('test to', OPS, r.ok && !r.skipped ? 'SENT' : JSON.stringify(r));
  console.log('subject:', subject);
  if (!process.argv.includes('--audience')) process.exit(0);
}

// ── segments ─────────────────────────────────────────────────────────────
const subs = await page('subscribers', 'email, name, source', (q) => q
  .is('unsubscribed_at', null).is('suppressed_at', null));
const live = subs.filter((s) => s.email && /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(s.email));
const byEmail = new Map(live.map((s) => [String(s.email).toLowerCase().trim(), s]));

// anyone who has EVER opened or clicked is warm, whatever their source
const coldSet = new Set(live.filter((s) => COLD_SOURCES.includes(String(s.source || '')))
  .map((s) => String(s.email).toLowerCase().trim()));
const ids = [...coldSet];
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await db.from('email_events').select('email')
    .in('email', ids.slice(i, i + 200)).in('event', ['opened', 'clicked']).limit(4000);
  for (const e of data || []) coldSet.delete(String(e.email).toLowerCase().trim());
}

const warm = [...byEmail.keys()].filter((e) => !coldSet.has(e));
const core = warm.filter((e) => DIRECT.has(String(byEmail.get(e)?.source || '')));
const pool = AUDIENCE === 'core' ? core : AUDIENCE === 'warm' ? warm : AUDIENCE === 'cold' ? [...coldSet] : null;
if (!pool) { console.error('--audience must be core, warm or cold'); process.exit(1); }

const already = new Set((await page('email_send_log', 'recipient, batch_key', (q) => q
  .eq('status', 'sent').like('batch_key', 'diamond-launch:%')))
  .map((r) => String(r.recipient || '').toLowerCase().trim()));

const members = new Set((await page('member_subscriptions', 'email', (q) => q.eq('plan_slug', DIAMOND_SLUG).in('status', ['active', 'expired'])))
  .map((r) => String(r.email || '').toLowerCase().trim()));
const list = pool.filter((e) => !already.has(e) && !members.has(e));

console.log(`mailable ${live.length} · core ${core.length} · warm ${warm.length} · cold ${coldSet.size}`);
console.log(`already had it: ${already.size}`);
console.log(`AUDIENCE "${AUDIENCE}" -> TO SEND: ${list.length}`);
if (!list.length) { console.log('nothing to do.'); process.exit(0); }
if (!APPLY) { console.log('dry run. add --apply to send.'); process.exit(0); }
if (!launched) { console.error(`STOP: Diamond Select is not launched yet (available_from ${plan?.available_from}). Set the launch date first.`); process.exit(1); }

let sent = 0, stopped = '';
for (let i = 0; i < list.length; i += 100) {
  const slice = list.slice(i, i + 100);
  const batch = slice.map((to) => {
    const { subject, html, text } = makeEmail(to, byEmail.get(to)?.name || null);
    return { to, subject, html, text, headers: unsubHeaders(to), tags: [{ name: 'kind', value: 'diamondLaunch' }] };
  });
  const r = await sendBatch(batch, `diamond-launch:${AUDIENCE}:${i}`);
  if (r.ok) { sent += r.sent || slice.length; process.stdout.write(`  ${sent}/${list.length}\r`); }
  else { stopped = String(r.error || 'batch failed'); break; }
}
console.log(`\nsent ${sent}${stopped ? ` then stopped: ${stopped}` : ''}`);
