// Re-run Cut Local matching for one open request and email the makers who were
// not told before (new matching rules of 2026-09-30, src/lib/maker-reach.ts).
//
//   npx tsx scripts/cutlocal_rematch.mjs <request id>    preview: who would be emailed, and the email text
//
// PREVIEW ONLY. Sending lives in Admin > Makers > Live marketplace > (open the
// request) > "Email the job to N makers", which runs on the live site. The
// email carries a maker sign-in link, and the live site rejects links signed
// on this machine (different secret): found 2026-09-30 before anything went out.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { matchMakers, notifyMakersOfJob, jobEmail } from '../src/lib/marketplace.ts';

const id = process.argv[2], SEND = false;
if (process.argv.includes('--send')) { console.error('Sending is done from Admin > Makers (links must be signed by the live site). This script only previews.'); process.exit(1); }
if (!/^[0-9a-f-]{36}$/i.test(id || '')) { console.error('usage: npx tsx scripts/cutlocal_rematch.mjs <request id>'); process.exit(1); }
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: req, error } = await db.from('maker_requests').select('*').eq('id', id).maybeSingle();
if (error || !req) { console.error('request not found', error?.message || ''); process.exit(1); }
if (req.status !== 'open') { console.error(`request is ${req.status}, not open: nothing to do`); process.exit(1); }
console.log(`request ${id.slice(0, 8)}: ${(req.product_title || '').split('|')[0].trim()} | ${req.city}, ${req.region}, ${req.country} | ${req.delivery}\n`);

const makers = await matchMakers(db, req);
const { data: sent } = await db.from('email_send_log').select('recipient,batch_key').like('batch_key', `mp-job:${id}:%`);
const already = new Set((sent || []).map((s) => s.recipient.toLowerCase()));
const fresh = makers.filter((m) => !already.has(String(m.email).toLowerCase()));
for (const m of makers) console.log(`${already.has(String(m.email).toLowerCase()) ? 'already told' : 'WILL EMAIL  '} | ${m._reach.kind.padEnd(7)} | ${m._reach.km ?? '?'} km | ${m.maker_name} (${m.city}, ${m.region}, ${m.country}) | materials: ${(m.materials || []).join(', ') || '-'}`);
console.log(`\n${makers.length} match, ${fresh.length} not told yet`);

if (!SEND) {
  // the exact email the first new maker would get (sign-in link shortened), nothing sent
  if (fresh[0]) {
    const e = jobEmail(fresh[0], req);
    const plain = e.html.replace(/<p[^>]*>/g, '\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim();
    console.log(`\n--- email preview for ${fresh[0].maker_name} ---\nSubject: ${e.subject}\n\n${plain.replace(/\?t=[^"\s]+/g, '?t=...')}\n---`);
  }
  console.log('\n(preview: nothing sent. To send, open the request in Admin > Makers > Live marketplace.)');
  process.exit(0);
}
await notifyMakersOfJob(fresh, req);
console.log(`\nsent to ${fresh.length} maker(s)`);
