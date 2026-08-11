// Send THIS WEEK's fresh-designs digest to confirmed+active subscribers who have
// NOT already received it — determined precisely from the email_events log
// (kind='weekly'). No PDF. Owner-approved.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { weeklyDigestEmail, applyOverride, TEMPLATE_HEADINGS } from '../.digest_send/marketing-emails.mjs';
import { sendBatch } from '../.digest_send/resend.mjs';
import { isoWeekKey } from '../.digest_send/weekly-digest.mjs';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// who already got this week's digest (from the Resend webhook event log)
const { data: ev } = await db.from('email_events').select('email').eq('kind', 'weekly').limit(20000);
const alreadySent = new Set((ev || []).map((r) => (r.email || '').toLowerCase().trim()).filter(Boolean));

// audience = confirmed + active subscribers
const { data: subs } = await db.from('subscribers').select('email').not('confirmed_at', 'is', null).is('unsubscribed_at', null).limit(10000);
const TEST = /fake|mailinator|@example\.|@test\.|\.invalid|localhost/i;
const audience = [...new Set((subs || []).map((r) => r.email.toLowerCase().trim()))]
  .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !TEST.test(e));
const leftover = audience.filter((e) => !alreadySent.has(e));
console.log(`already received (from events): ${alreadySent.size} · confirmed+active: ${audience.length} · to send now: ${leftover.length}`);
if (!leftover.length) { console.log('everyone already has it — nothing to send.'); process.exit(0); }

// same designs as the original send: added in the last 7 days
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
  const res = await sendBatch(chunk, `digest:${week}:new${c / 100}`);
  if (res.ok) sent += res.sent; else { failed += chunk.length; console.error('chunk failed:', res.error); }
}
console.log(`\n✅ sent to newly-added subscribers: ${sent} delivered, ${failed} failed.`);
