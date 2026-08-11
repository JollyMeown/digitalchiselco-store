// One-off: send THIS WEEK's fresh-designs digest to all confirmed subscribers
// right now (owner-approved). Uses the exact same builders as the Monday cron.
// Claims the current ISO week in weekly_digest_log so Monday's run (a different
// ISO week) is unaffected and this week can't double-send.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { buildWeeklyPdf, isoWeekKey } from '../.digest_send/weekly-digest.mjs';
import { weeklyDigestEmail, applyOverride, TEMPLATE_HEADINGS } from '../.digest_send/marketing-emails.mjs';
import { sendBatch } from '../.digest_send/resend.mjs';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const week = isoWeekKey();

// claim the week (idempotent — aborts if already sent)
const { error: claimErr } = await db.from('weekly_digest_log').insert({ week_key: week });
if (claimErr) { console.log(`week ${week} already logged — NOT re-sending.`); process.exit(0); }

const since = new Date(Date.now() - 7 * 86400000).toISOString();
const { data: fresh } = await db.from('products')
  .select('title, slug, price_usd, image_url, created_at')
  .eq('active', true).gte('created_at', since)
  .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
  .order('created_at', { ascending: false }).limit(60);
if (!fresh?.length) { console.log('no fresh products this week — nothing to send.'); await db.from('weekly_digest_log').update({ sent_count: 0, product_count: 0 }).eq('week_key', week); process.exit(0); }
console.log(`week ${week}: ${fresh.length} new designs`);

// branded lookbook PDF → storage
let pdfUrl = null;
try {
  const bytes = await buildWeeklyPdf(fresh, week);
  const path = `weekly/DCC-Fresh-Designs-${week}.pdf`;
  const up = await db.storage.from('site-media').upload(path, Buffer.from(bytes), { contentType: 'application/pdf', upsert: true });
  if (up.error) console.error('pdf upload error:', up.error.message);
  else pdfUrl = db.storage.from('site-media').getPublicUrl(path).data.publicUrl;
  console.log('pdf:', pdfUrl ? 'built (' + (bytes.length / 1024).toFixed(0) + 'KB)' : 'failed');
} catch (e) { console.error('pdf build failed (email still sends):', e.message); }

// audience: confirmed, non-unsubscribed subscribers
const { data: subs } = await db.from('subscribers').select('email').not('confirmed_at', 'is', null).is('unsubscribed_at', null).limit(3000);
// Safety filter: valid format + no test/example domains (Resend rejects a whole
// batch if any recipient is a test domain).
const TEST_DOM = /@(example\.(com|org|net)|test\.|localhost|mailinator\.com)/i;
const list = [...new Set((subs || []).map((r) => r.email.toLowerCase().trim()))]
  .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !TEST_DOM.test(e));
console.log('recipients:', list.length);

// owner template override (if any)
const { data: ov } = await db.from('email_template_overrides').select('*').eq('kind', 'weekly').maybeSingle();

const fmtDay = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const range = `${fmtDay(fresh[fresh.length - 1].created_at)} – ${fmtDay(fresh[0].created_at)}`;
const weekNumber = Number(week.split('-W')[1]) || 0;
const tags = [{ name: 'kind', value: 'weekly' }, { name: 'week', value: week }];

let sent = 0, failed = 0;
for (let c = 0; c < list.length; c += 100) {
  const chunk = list.slice(c, c + 100).map((email) => {
    const base = weeklyDigestEmail({ email, products: fresh, pdfUrl, weekNumber, range });
    const { subject, html, text } = applyOverride(base, ov, email, TEMPLATE_HEADINGS['weekly'] || '');
    return { to: email, subject, html, text, tags };
  });
  const res = await sendBatch(chunk, `digest:${week}:chunk${c / 100}`);
  if (res.ok) sent += res.sent; else { failed += chunk.length; console.error('chunk failed:', res.error); }
}
await db.from('weekly_digest_log').update({ sent_count: sent, product_count: fresh.length, pdf_url: pdfUrl }).eq('week_key', week);
console.log(`\n✅ weekly digest sent: ${sent} delivered, ${failed} failed · week ${week} · ${fresh.length} designs · pdf ${pdfUrl ? 'attached' : 'none'}`);
