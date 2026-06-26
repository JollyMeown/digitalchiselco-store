// Cleans up the "unconfirmed" subscribers stuck in the Free STL Pack group
// in MailerLite. These are people who signed up before our Resend-driven
// double-opt-in shipped — MailerLite either never sent them a confirmation
// or it never got clicked.
//
// Usage:
//   node scripts/cleanup_unconfirmed_mailerlite.mjs                # dry run, list everyone
//   node scripts/cleanup_unconfirmed_mailerlite.mjs --activate --apply
//        → flip every unconfirmed row to status='active' (fires the welcome
//          automation; each subscriber finally receives the 5-file pack)
//   node scripts/cleanup_unconfirmed_mailerlite.mjs --delete --apply
//        → remove every unconfirmed row instead (a true clean slate)
//
// Choose ONE of --activate or --delete. Dry run by default.

import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const ACTIVATE = process.argv.includes('--activate');
const DELETE = process.argv.includes('--delete');

if (APPLY && !ACTIVATE && !DELETE) {
  console.error('✗ Pass --activate OR --delete alongside --apply.');
  process.exit(1);
}
if (ACTIVATE && DELETE) {
  console.error('✗ Choose one: --activate or --delete.');
  process.exit(1);
}

const API = 'https://connect.mailerlite.com/api';
const key = process.env.MAILERLITE_API_KEY;
const groupId = process.env.MAILERLITE_FREE_GROUP_ID;
if (!key || !groupId) { console.error('Set MAILERLITE_API_KEY and MAILERLITE_FREE_GROUP_ID in .env'); process.exit(1); }

const action = ACTIVATE ? 'activate (welcome automation fires)' : DELETE ? 'delete (remove from MailerLite)' : 'list only';
console.log(APPLY ? `🚀 APPLY mode — will ${action}.` : `🔍 DRY RUN — no writes. Action would be: ${action}. Re-run with --apply.`);
console.log();

// Paginate the group's subscribers
async function fetchUnconfirmed() {
  const out = [];
  let cursor = null;
  for (let page = 1; page <= 20; page++) {
    const params = new URLSearchParams({ 'filter[status]': 'unconfirmed', limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const r = await fetch(`${API}/groups/${groupId}/subscribers?${params}`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    });
    const j = await r.json();
    if (!j.data) { console.error('Fetch failed:', JSON.stringify(j).slice(0, 200)); break; }
    out.push(...j.data);
    cursor = j.meta?.next_cursor;
    if (!cursor || j.data.length < 100) break;
  }
  return out;
}

const rows = await fetchUnconfirmed();
console.log(`Found ${rows.length} unconfirmed subscribers in the Free STL Pack group.\n`);
if (!rows.length) { console.log('Nothing to do.'); process.exit(0); }

console.log('id'.padEnd(22), 'status'.padEnd(12), 'created_at'.padEnd(22), 'email');
console.log('-'.repeat(100));
for (const s of rows) {
  console.log(
    String(s.id).padEnd(22),
    String(s.status).padEnd(12),
    String(s.created_at || '').padEnd(22),
    s.email,
  );
}

if (!APPLY) {
  console.log('\nDry run complete. Pick --activate or --delete, then re-run with --apply.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const s of rows) {
  let r, body;
  if (ACTIVATE) {
    r = await fetch(`${API}/subscribers/${s.id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    body = await r.json().catch(() => ({}));
  } else {
    r = await fetch(`${API}/subscribers/${s.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${key}` },
    });
    body = null;
  }
  if (!r.ok) {
    console.error(`  ✗ ${s.email}: HTTP ${r.status}`, body?.message || '');
    fail++;
  } else {
    ok++;
    process.stdout.write(`\r  processed ${ok}/${rows.length}`);
  }
}
process.stdout.write('\n');
console.log(`\nDone. ${ACTIVATE ? 'Activated' : 'Deleted'}: ${ok}, failed: ${fail}.`);
if (ACTIVATE && ok > 0) {
  console.log('\nThe Free STL Pack welcome automation fires per activated subscriber — each');
  console.log('should receive the delivery email within a couple of minutes.');
}
