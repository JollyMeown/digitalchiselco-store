// Announce CNC Match to the people who own a CNC.
//
// Same audience split as the admin endpoint, because the split is the point.
// The list is 2,222 mailable addresses and most of them are imported Etsy
// buyers. A single blast at all of them is how a sending domain collects the
// spam complaints that then cost deliverability on the people who do read.
//
//   core  the people who came to us directly: free pack, buyers, members,
//         and the old MailerLite list. About 180. Small enough to read a
//         complaint rate from before committing the rest.
//   warm  core plus every imported address that has ever opened or clicked.
//         About 1,250. Engagement, not source, is what makes someone warm.
//   cold  the remainder, who have never once opened anything.
//
//   node --env-file=.env --import tsx scripts/send_cnc_match.mjs --test
//   node --env-file=.env --import tsx scripts/send_cnc_match.mjs --audience core
//   node --env-file=.env --import tsx scripts/send_cnc_match.mjs --audience core --apply
//
// Dedupes against the central ledger on the cnc-match: batch key, so a second
// run reaches only people who have not had it and a later wave never re-mails
// an earlier one.
import { createClient } from '@supabase/supabase-js';
import { cncMatchEmail, unsubHeaders } from '../src/lib/marketing-emails.ts';
import { sendBatch, send as sendOne } from '../src/lib/resend.ts';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const TEST = process.argv.includes('--test');
const AUDIENCE = String(arg('audience', 'core'));
const OPS = 'jolly@digitalchiselco.com';
const COLD_SOURCES = ['etsy-buyer', 'Etsy', 'import'];
const DIRECT = new Set(['free-pack', 'buyer', 'membership', 'custom-ask', 'mailerlite']);

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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
  const { subject, html, text } = cncMatchEmail({ email: OPS, name: null });
  const r = await sendOne({
    to: OPS, subject: `[TEST] ${subject}`, html, text, headers: unsubHeaders(OPS),
    idempotencyKey: `cnc-match-test:${Date.now()}`, tags: [{ name: 'kind', value: 'auth' }],
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
  .eq('status', 'sent').like('batch_key', 'cnc-match:%')))
  .map((r) => String(r.recipient || '').toLowerCase().trim()));

const list = pool.filter((e) => !already.has(e));

console.log(`mailable ${live.length} · core ${core.length} · warm ${warm.length} · cold ${coldSet.size}`);
console.log(`already had it: ${already.size}`);
console.log(`AUDIENCE "${AUDIENCE}" -> TO SEND: ${list.length}`);
if (!list.length) { console.log('nothing to do.'); process.exit(0); }
if (!APPLY) { console.log('dry run. add --apply to send.'); process.exit(0); }

let sent = 0, stopped = '';
for (let i = 0; i < list.length; i += 100) {
  const slice = list.slice(i, i + 100);
  const batch = slice.map((to) => {
    const { subject, html, text } = cncMatchEmail({ email: to, name: byEmail.get(to)?.name || null });
    return { to, subject, html, text, headers: unsubHeaders(to), tags: [{ name: 'kind', value: 'cncMatch' }] };
  });
  const r = await sendBatch(batch, `cnc-match:${AUDIENCE}:${i}`);
  if (r.ok) { sent += r.sent || slice.length; process.stdout.write(`  ${sent}/${list.length}\r`); }
  else { stopped = String(r.error || 'batch failed'); break; }
}
console.log(`\nsent ${sent}${stopped ? ` then stopped: ${stopped}` : ''}`);
