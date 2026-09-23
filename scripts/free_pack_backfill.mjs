// Send every free-pack subscriber a permanent link to their files.
//
// Two different situations, two different emails, because they are owed
// different things:
//   A. asked for the pack, never clicked the confirmation link, so the
//      MailerLite automation that ships the files never fired. These people
//      genuinely never received anything. They get an apology.
//   B. confirmed, so the pack WAS sent once. They are not owed an apology and
//      must not be told their files failed. They get a permanent link to
//      replace the email they may well have lost, which is the thing that had
//      been arriving in the owner's inbox by hand.
//
// Dry run by default. Nothing sends without --apply.
//   node scripts/free_pack_backfill.mjs                 # show who and what
//   node scripts/free_pack_backfill.mjs --group a --apply
//   node scripts/free_pack_backfill.mjs --apply         # both groups
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { freePackLink, send as sendEmail } from '../.digest_send/free_pack.mjs';   // esbuild bundle of src/lib, same pattern as the other send scripts

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const GROUP = (args[args.indexOf('--group') + 1] || 'both').toLowerCase();
const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');

// Test rows left behind by development. They are not people and must never be
// counted in a send.
const isJunk = (e) => /^claude-|^deploycheck@|@example\.(invalid|com)$/i.test(e);

const { data: rows, error } = await db.from('subscribers')
  .select('email, name, confirmed_at, unsubscribed_at, suppressed_at, free_pack_token')
  .eq('source', 'free-pack').order('created_at');
if (error) { console.error(error.message); process.exit(1); }

const people = rows.filter((r) => !isJunk(r.email) && !r.unsubscribed_at && !r.suppressed_at);
const groupA = people.filter((r) => !r.confirmed_at);   // never received anything
const groupB = people.filter((r) => r.confirmed_at);    // received it once
const todo = GROUP === 'a' ? groupA : GROUP === 'b' ? groupB : [...groupA, ...groupB];

const { data: gs } = await db.from('growth_settings').select('free_pack_url').eq('id', 1).maybeSingle();
const packUrl = gs?.free_pack_url || '';
if (!packUrl) { console.error('growth_settings.free_pack_url is empty — nothing to send'); process.exit(1); }

console.log(`free-pack subscribers: ${rows.length} (${rows.length - people.length} excluded: test rows, unsubscribed or suppressed)`);
console.log(`  A never received the pack : ${groupA.length}`);
console.log(`  B received it once already: ${groupB.length}`);
console.log(`\n${APPLY ? 'SENDING' : 'DRY RUN'} to ${todo.length}\n`);

if (!APPLY) {
  for (const g of [['A', groupA[0]], ['B', groupB[0]]]) {
    if (!g[1]) continue;
    const { subject, text } = freePackLink({ name: g[1].name, filesUrl: `${SITE}/free/files?k=<key>`, packUrl, missed: !g[1].confirmed_at });
    console.log(`──── GROUP ${g[0]} · subject: ${subject}\n${text}\n`);
  }
  console.log(`re-run with --apply to send`);
  process.exit(0);
}

let ok = 0, fail = 0;
for (const p of todo) {
  try {
    let key = p.free_pack_token;
    if (!key) {
      key = randomBytes(24).toString('base64url');
      const { error: e2 } = await db.from('subscribers').update({ free_pack_token: key }).eq('email', p.email);
      if (e2) throw new Error(`could not store key: ${e2.message}`);
    }
    const { subject, html, text } = freePackLink({
      name: p.name, filesUrl: `${SITE}/free/files?k=${encodeURIComponent(key)}`, packUrl, missed: !p.confirmed_at,
    });
    await sendEmail({
      to: p.email, subject, html, text,
      // Stable key: running this twice must not mail anyone twice.
      idempotencyKey: `free-pack-backfill:${p.email}`,
      tags: [{ name: 'kind', value: 'optin' }],
    });
    ok++;
    console.log(`  ✓ ${p.confirmed_at ? 'B' : 'A'} ${p.email}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${p.email}: ${String(e?.message || e).slice(0, 120)}`);
  }
  await new Promise((r) => setTimeout(r, 600));   // stay under Resend's rate limit
}
console.log(`\ndone: ${ok} sent, ${fail} failed`);
