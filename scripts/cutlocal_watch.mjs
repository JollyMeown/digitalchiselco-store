// Keep an eye on one Cut Local request, and send the buyer the owner-approved
// "where things stand" note when it is due and still true.
//
//   npx tsx scripts/cutlocal_watch.mjs <request id> [--buyer-after <ISO time>]
//
// Prints a short status report (quotes, which makers were emailed, what to do).
// With --buyer-after, sends the buyer note once, and only when ALL hold:
//   - the time has passed and the request is still open with no quotes;
//   - at least one maker near the border was really emailed, because the note
//     tells the buyer "I have asked them" (the Admin button, sent by the live site);
//   - it was not sent before (email_send_log key cutlocal-buyer-update:<id>).
// Otherwise it says why it held back. The note has no maker sign-in link, so it
// is safe to send from this machine.
//
// Written 2026-09-30 for the first real request (Jacqueline, Magog, Quebec).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { send } from '../src/lib/resend.ts';

const id = process.argv[2];
const i = process.argv.indexOf('--buyer-after'), buyerAfter = i > 0 ? new Date(process.argv[i + 1]) : null;
if (!/^[0-9a-f-]{36}$/i.test(id || '')) { console.error('usage: npx tsx scripts/cutlocal_watch.mjs <request id> [--buyer-after <ISO time>]'); process.exit(1); }
if (buyerAfter && isNaN(buyerAfter.getTime())) { console.error('bad --buyer-after time'); process.exit(1); }
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const KEY = `cutlocal-buyer-update:${id}`;
const hoursAgo = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 3600e3);

const { data: req, error } = await db.from('maker_requests').select('*').eq('id', id).maybeSingle();
if (error || !req) { console.log(`STATUS: request ${id} not found ${error?.message || ''}`); process.exit(1); }
const title = (req.product_title || 'your design').split('|')[0].trim();
const { data: quotes } = await db.from('maker_quotes').select('price, lead_days, message, status, created_at, makers(maker_name, city, region, country)').eq('request_id', id).order('created_at');
const { data: jobMails } = await db.from('email_send_log').select('recipient, sent_at, status').like('batch_key', `mp-job:${id}:%`);
const toldEmails = [...new Set((jobMails || []).filter((m) => m.status === 'sent').map((m) => m.recipient.toLowerCase()))];
const { data: toldMakers } = toldEmails.length ? await db.from('makers').select('maker_name, email, country').in('email', toldEmails) : { data: [] };
const borderTold = (toldMakers || []).filter((m) => !/^(ca|can|canada)$/i.test(String(m.country || '').trim()));
const { data: buyerNote } = await db.from('email_send_log').select('sent_at, status').eq('batch_key', KEY).eq('status', 'sent').limit(1);

console.log(`REQUEST: ${title} | ${req.city}, ${req.region}, ${req.country} | status ${req.status} | posted ${hoursAgo(req.created_at)} h ago | wanted ${req.deadline || 'flexible'}`);
console.log(`MAKERS EMAILED (${(toldMakers || []).length}): ${(toldMakers || []).map((m) => m.maker_name).join(', ') || 'none'}`);
console.log(`QUOTES (${(quotes || []).length}): ${(quotes || []).map((q) => `${q.makers?.maker_name}: $${Number(q.price).toFixed(2)}${q.lead_days ? `, ${q.lead_days} days` : ''} (${q.status})`).join(' | ') || 'none'}`);
console.log(`BUYER NOTE: ${buyerNote?.length ? `sent ${buyerNote[0].sent_at.slice(0, 16)} UTC` : 'not sent'}`);

let action = '';
if (req.status !== 'open') action = `Request is ${req.status}. Nothing to send; the watch can be ended.`;
else if ((quotes || []).length) action = `Quotes are in. Buyer note NOT needed (she is emailed about each quote automatically). Watch whether she awards one.`;
else if (!borderTold.length) action = `HOLD: the two makers near the border have not been emailed yet. Owner: Admin > Makers > Live marketplace > open the request > "Email the job to 2 makers not told yet". The buyer note says "I have asked them", so it waits for that.`;
else if (buyerNote?.length) action = `Buyer note already sent. Waiting for quotes.`;
else if (!buyerAfter) action = `No quotes yet. (Buyer note not scheduled in this run.)`;
else if (Date.now() < buyerAfter.getTime()) action = `No quotes yet. Buyer note due after ${buyerAfter.toISOString().slice(0, 16)} UTC.`;
else {
  const first = String(req.buyer_name || '').trim().split(/\s+/)[0] || 'there';
  const spec = [req.material && `in ${String(req.material).toLowerCase()}`, req.size, req.finish && String(req.finish).toLowerCase()].filter(Boolean).join(', ');
  const paras = [
    `Hi ${first},`,
    `Thank you for your request to have the ${title.replace(/ Bas-Relief STL Carving$/i, '')} carved${spec ? ' ' + spec : ''}.`,
    `I wanted to let you know where things stand. Cut Local is still young and most of our makers are in the United States. The closest to you are in New York and Pennsylvania, and I have asked them whether they can make it and ship it to Magog. Shipping and any customs would be part of their quote.`,
    `Would a maker shipping from the US work for you? If you would rather have someone in Canada, tell me and I will keep looking.`,
    `Quotes appear on the page linked in your confirmation email, and you will get an email as soon as one arrives.`,
    `Best regards,<br/>Jolly<br/>DigitalChiselCo`,
  ];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2a241d;font-size:15px;line-height:1.55;">${paras.map((p, k) => `<p>${k === paras.length - 1 ? p : esc(p)}</p>`).join('')}</div>`;
  const text = paras.map((p) => p.replace(/<br\/>/g, '\n')).join('\n\n');
  const r = await send({
    to: req.buyer_email, subject: `Your Cut Local request: the ${title.replace(/ Bas-Relief STL Carving$/i, '')}${req.material ? ' in ' + String(req.material).toLowerCase() : ''}`,
    html, text, idempotencyKey: KEY, tags: [{ name: 'kind', value: 'order' }],
  });
  action = r.ok && !r.skipped ? `SENT the buyer note to ${req.buyer_email}.` : `Buyer note NOT sent: ${r.error || (r.skipped ? 'skipped (already sent?)' : 'unknown')}${r.quota ? ' (quota)' : ''}`;
}
console.log(`ACTION: ${action}`);
