// Manual "send now" for the Etsy-buyer welcome (same email the Automation sends).
// Use this to welcome the current batch immediately instead of waiting for the
// daily cron. Shares the etsy_welcome_log dedup with the Automation, so nobody
// is ever emailed twice by either path.
//
//   node scripts/send_etsy_welcome.mjs           # dry run: audience + preview.html, sends nothing
//   node scripts/send_etsy_welcome.mjs --apply   # actually send
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { etsyWelcomeEmail } from '../.digest_send/marketing-emails.mjs';
import { sendBatch } from '../.digest_send/resend.mjs';

const APPLY = process.argv.includes('--apply');
// Optional wave cap: --limit 60 sends only the first 60 pending (dedup means a
// second run picks up where this one stopped). Lets us send in waves.
const limArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limArg ? Math.max(1, Number(limArg.split('=')[1]) || 0) : Infinity;
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// audience = imported Etsy buyers, confirmed + not unsubscribed
const { data: subs, error } = await db.from('subscribers')
  .select('email').eq('source', 'etsy-buyer').not('confirmed_at', 'is', null).is('unsubscribed_at', null).limit(5000);
if (error) { console.error('audience query failed:', error.message); process.exit(1); }

// never send twice: skip anyone already in the welcome log (shared with the cron automation)
const { data: done } = await db.from('etsy_welcome_log').select('email').limit(20000);
const welcomed = new Set((done || []).map((r) => (r.email || '').toLowerCase().trim()));

const TEST = /fake|mailinator|@example\.|@test\.|\.invalid|localhost/i;
const pendingAll = [...new Set((subs || []).map((r) => r.email.toLowerCase().trim()))]
  .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !TEST.test(e) && !welcomed.has(e));
const audience = pendingAll.slice(0, LIMIT);

console.log(`etsy-buyer subscribers: ${subs?.length || 0} · already welcomed: ${welcomed.size} · pending: ${pendingAll.length}${LIMIT !== Infinity ? ` · this wave: ${audience.length}` : ''} · to send now: ${audience.length}`);

// this week's newest designs (up to 12 shown) + total count for the "see all" link
const sinceIso = new Date(Date.now() - 7 * 86400000).toISOString();
const [{ data: freshRaw }, { count: newCount }] = await Promise.all([
  db.from('products').select('title, slug, price_usd, image_url')
    .eq('active', true).gte('created_at', sinceIso)
    .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
    .order('created_at', { ascending: false }).limit(12),
  db.from('products').select('id', { count: 'exact', head: true })
    .eq('active', true).gte('created_at', sinceIso)
    .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null),
]);
const products = freshRaw || [];
const totalNew = newCount || products.length;
console.log(`featuring ${products.length} of ${totalNew} new designs from this week`);

// write a preview you can open in a browser
const previewHtml = etsyWelcomeEmail({ email: 'preview@digitalchiselco.com', products, totalNew, code: 'THANKYOU10' }).html;
const previewPath = 'scripts/.etsy-welcome-preview.html';
writeFileSync(previewPath, previewHtml);
console.log(`preview written → ${previewPath} (open it in a browser)`);

if (!audience.length) { console.log('Nobody to send to.'); process.exit(0); }
if (!APPLY) { console.log(`\nDRY RUN. Re-run with --apply to send to ${audience.length} buyers.`); process.exit(0); }

const tags = [{ name: 'kind', value: 'etsy-welcome' }];
let sent = 0, failed = 0;
for (let c = 0; c < audience.length; c += 100) {
  const batch = audience.slice(c, c + 100);
  const chunk = batch.map((email) => {
    const { subject, html, text } = etsyWelcomeEmail({ email, products, totalNew, code: 'THANKYOU10' });
    return { to: email, subject, html, text, tags };
  });
  // Idempotency key = hash of THIS batch's recipients, so retries of the same
  // people dedupe but different waves never collide on a positional index.
  const idem = 'etsy-welcome:' + crypto.createHash('sha256').update([...batch].sort().join(',')).digest('hex').slice(0, 32);
  const res = await sendBatch(chunk, idem);
  if (res.ok) {
    sent += res.sent;
    await db.from('etsy_welcome_log').upsert(batch.map((email) => ({ email })), { onConflict: 'email', ignoreDuplicates: true });
  } else { failed += batch.length; console.error('chunk failed:', res.error); }
}
console.log(`\n✅ welcome sent: ${sent} delivered, ${failed} failed.`);
