// Broadcast one article to ENGAGED subscribers only.
//
// The drip mails each person their OLDEST unread guide, so a brand new article
// waits at the back of the queue. This sends it now, but only to people who
// have opened or clicked something in the last 90 days: a fresh blast at the
// 800 who never open is what drags a sending domain into spam.
//
// Dedupes against the send ledger (all article kinds), skips unsubscribed,
// suppressed and unconfirmed, and stops cleanly if the daily budget runs out.
//
//   node --env-file=.env --import tsx scripts/send_article_engaged.mjs <slug> --test
//   node --env-file=.env --import tsx scripts/send_article_engaged.mjs <slug> --apply
import { createClient } from '@supabase/supabase-js';
import { articleEmail, unsubHeaders } from '../src/lib/marketing-emails.ts';
import { sendBatch, send as sendOne } from '../src/lib/resend.ts';
import { engagedEmails } from '../src/lib/audience.ts';

const SLUG = process.argv.slice(2).find((a) => !a.startsWith('--'));
const APPLY = process.argv.includes('--apply');
const TEST = process.argv.includes('--test');
const OPS = 'jolly@digitalchiselco.com';
const KINDS = ['articleCampaign', 'articleDrip', 'guideCampaign', 'drip6'];
if (!SLUG) { console.error('usage: send_article_engaged.mjs <slug> [--test] [--apply]'); process.exit(1); }

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const page = async (table, select, apply) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(db.from(table).select(select)).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
};

const { data: post } = await db.from('posts')
  .select('slug, title, excerpt, body, cover_image_url, published_at, email_subject, email_intro, email_image_url')
  .eq('slug', SLUG).eq('status', 'published').maybeSingle();
if (!post) { console.error('no published post with that slug'); process.exit(1); }

if (TEST) {
  const { subject, html, text } = articleEmail({ email: OPS, post });
  const r = await sendOne({ to: OPS, subject: `[TEST] ${subject}`, html, text, headers: unsubHeaders(OPS), idempotencyKey: `article-test:${SLUG}:${Date.now()}`, tags: [{ name: 'kind', value: 'auth' }] });
  console.log('test to', OPS, r.ok && !r.skipped ? 'sent' : JSON.stringify(r));
  console.log('subject:', subject);
}

// audience: engaged, confirmed, still subscribed, not already sent this article
const engaged = await engagedEmails(db, 90);
const subs = await page('subscribers', 'email', (q) => q
  .not('confirmed_at', 'is', null).is('unsubscribed_at', null).is('suppressed_at', null));
const already = new Set((await page('email_send_log', 'recipient, subject, kind', (q) => q
  .in('kind', KINDS).eq('status', 'sent')))
  .filter((r) => String(r.subject || '').includes(String(post.email_subject || post.title).slice(0, 40)))
  .map((r) => String(r.recipient).toLowerCase()));
const list = [...new Set(subs.map((s) => String(s.email).toLowerCase()))]
  .filter((e) => engaged.has(e) && !already.has(e) && /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(e));

console.log(`engaged in 90 days: ${engaged.size} · mailable list: ${subs.length} · already had this article: ${already.size}`);
console.log(`TO SEND: ${list.length}`);
if (!APPLY) { console.log('dry run. add --apply to send.'); process.exit(0); }

let sent = 0, stopped = '';
for (let i = 0; i < list.length; i += 100) {
  const slice = list.slice(i, i + 100);
  const batch = slice.map((to) => {
    const { subject, html, text } = articleEmail({ email: to, post });
    return { to, subject, html, text, headers: unsubHeaders(to), tags: [{ name: 'kind', value: 'articleCampaign' }] };
  });
  const r = await sendBatch(batch, `article:${SLUG}:engaged:${i}`);
  if (r.ok) { sent += r.sent || slice.length; process.stdout.write(`  ${sent}/${list.length}\r`); }
  else { stopped = String(r.error || 'batch failed'); break; }
}
console.log(`\nsent ${sent}${stopped ? ` then stopped: ${stopped}` : ''}`);
