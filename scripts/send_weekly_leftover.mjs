// One-off: send the SAME fresh-designs digest to the subscribers on the CSV who
// did NOT already receive this week's send (owner-approved). No PDF — pictures +
// product-page links only. After sending, advances weekly_last_sent_at so the
// Monday cron starts fresh and never repeats these designs.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { weeklyDigestEmail, applyOverride, TEMPLATE_HEADINGS } from '../.digest_send/marketing-emails.mjs';
import { sendBatch } from '../.digest_send/resend.mjs';
import { isoWeekKey } from '../.digest_send/weekly-digest.mjs';

const CSV = process.argv[2] || 'C:/Users/karlg/Downloads/subscribers-2026-08-06.csv';
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TEST_DOM = /@(example\.|test\.|localhost|mailinator\.com|invalid)/i;
const valid = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !TEST_DOM.test(e);

// CSV emails (first quoted field per row, skip header)
const csvEmails = [...new Set(readFileSync(CSV, 'utf8').split(/\r?\n/).slice(1)
  .map((l) => (l.match(/"?([^",]+@[^",]+)"?/) || [])[1])
  .filter(Boolean).map((e) => e.toLowerCase().trim()).filter(valid))];

// Already emailed this week = confirmed, non-unsubscribed subscribers.
const { data: confirmed } = await db.from('subscribers').select('email').not('confirmed_at', 'is', null).is('unsubscribed_at', null).limit(5000);
const already = new Set((confirmed || []).map((r) => r.email.toLowerCase().trim()));
// exclude anyone who has unsubscribed at all (respect opt-outs)
const { data: unsub } = await db.from('subscribers').select('email').not('unsubscribed_at', 'is', null).limit(5000);
for (const r of unsub || []) already.add(r.email.toLowerCase().trim()); // treat unsub as "do not send"

const leftover = csvEmails.filter((e) => !already.has(e));
console.log(`CSV valid emails: ${csvEmails.length} · already-sent/unsub: excluded · leftover to send: ${leftover.length}`);
if (!leftover.length) { console.log('nobody left — done.'); process.exit(0); }

// same designs as the first send: added in the last 7 days
const since = new Date(Date.now() - 7 * 86400000).toISOString();
const { data: fresh } = await db.from('products')
  .select('title, slug, price_usd, image_url, created_at')
  .eq('active', true).gte('created_at', since)
  .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
  .order('created_at', { ascending: false }).limit(80);
if (!fresh?.length) { console.log('no fresh designs — aborting.'); process.exit(0); }
console.log(`designs: ${fresh.length}`);

const week = isoWeekKey();
const { data: ov } = await db.from('email_template_overrides').select('*').eq('kind', 'weekly').maybeSingle();
const fmtDay = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const range = `${fmtDay(fresh[fresh.length - 1].created_at)} – ${fmtDay(fresh[0].created_at)}`;
const weekNumber = Number(week.split('-W')[1]) || 0;
const tags = [{ name: 'kind', value: 'weekly' }, { name: 'week', value: week }];

let sent = 0, failed = 0;
for (let c = 0; c < leftover.length; c += 100) {
  const chunk = leftover.slice(c, c + 100).map((email) => {
    const base = weeklyDigestEmail({ email, products: fresh, weekNumber, range });
    const { subject, html, text } = applyOverride(base, ov, email, TEMPLATE_HEADINGS['weekly'] || '');
    return { to: email, subject, html, text, tags };
  });
  const res = await sendBatch(chunk, `digest:${week}:leftover${c / 100}`);
  if (res.ok) sent += res.sent; else { failed += chunk.length; console.error('chunk failed:', res.error); }
}
// advance the marker so Monday's cron only sends designs added AFTER now
await db.from('site_settings').update({ weekly_last_sent_at: new Date().toISOString() }).eq('id', 1);
console.log(`\n✅ leftover digest sent: ${sent} delivered, ${failed} failed · marker advanced (Monday starts fresh).`);
