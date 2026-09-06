// Pull every buyer email from the shop's Etsy receipts (needs the email_r
// scope: re-run scripts/etsy_oauth.mjs once, it now asks for it) and add the
// ones we do not have to subscribers as source='etsy-buyer', confirmed, so
// the one-time Etsy welcome + weekly digest reach them. Skips anyone already
// on the list or unsubscribed. Nothing is emailed by this script.
//
//   node scripts/import_etsy_receipts.mjs --dry     # count only
//   node scripts/import_etsy_receipts.mjs           # import
//   node scripts/import_etsy_receipts.mjs --since=2025-01-01
//
// Owner decision (2026-09-06): Etsy's seller policy restricts using buyer
// details for unsolicited marketing. The welcome email is a thank-you with an
// unsubscribe link, the same treatment the manually pasted buyers get.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const DRY = process.argv.includes('--dry');
const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const minCreated = sinceArg ? Math.floor(Date.parse(sinceArg.split('=')[1]) / 1000) : 0;
const SHOP_ID = 61524055;
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEST = /fake|mailinator|@example\.|@test\.|\.invalid|localhost/i;

const buyers = new Map();                       // email -> { name, first, last, orders }
let offset = 0, total = Infinity, pages = 0, noEmail = 0;
while (offset < total) {
  const r = await etsy(`/shops/${SHOP_ID}/receipts?limit=100&offset=${offset}&sort_on=created&sort_order=desc`, { oauth: true });
  total = r.count || 0; pages++;
  let stop = false;
  for (const rc of r.results || []) {
    if (rc.created_timestamp < minCreated) { stop = true; break; }
    const email = String(rc.buyer_email || '').trim().toLowerCase();
    if (!email) { noEmail++; continue; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || TEST.test(email)) continue;
    const b = buyers.get(email) || { name: rc.name || null, first: rc.created_timestamp, last: rc.created_timestamp, orders: 0 };
    b.orders++; b.first = Math.min(b.first, rc.created_timestamp); b.last = Math.max(b.last, rc.created_timestamp);
    buyers.set(email, b);
  }
  if (stop) break;
  offset += 100;
  await sleep(150);
}
console.log(`receipts: ${total} · pages read: ${pages} · unique buyer emails: ${buyers.size} · receipts without an email: ${noEmail}`);
if (noEmail && !buyers.size) { console.error('No emails at all: the token lacks the email_r scope. Run: node scripts/etsy_oauth.mjs'); process.exit(1); }

const emails = [...buyers.keys()];
const existing = new Set();
for (let i = 0; i < emails.length; i += 500) {
  const { data } = await db.from('subscribers').select('email').in('email', emails.slice(i, i + 500));
  for (const r of data || []) existing.add(String(r.email).toLowerCase());
}
const toAdd = emails.filter((e) => !existing.has(e));
console.log(`already on the list: ${existing.size} · new: ${toAdd.length}${DRY ? '  (dry run, nothing written)' : ''}`);
if (!DRY && toAdd.length) {
  const now = new Date().toISOString();
  let added = 0;
  for (let i = 0; i < toAdd.length; i += 200) {
    const rows = toAdd.slice(i, i + 200).map((email) => ({ email, name: buyers.get(email).name, source: 'etsy-buyer', confirmed_at: now }));
    const { error } = await db.from('subscribers').upsert(rows, { onConflict: 'email', ignoreDuplicates: true });
    if (error) console.error('insert failed:', error.message); else added += rows.length;
  }
  console.log(`✅ added ${added} Etsy buyers (source etsy-buyer, confirmed). The nightly Etsy-buyer welcome sends each ONE thank-you with THANKYOU10; then the weekly digest.`);
}
