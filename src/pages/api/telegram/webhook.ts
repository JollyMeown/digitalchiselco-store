// Telegram bot commands — your admin in your pocket, free.
//
// Telegram POSTs every message sent to the bot here. Security:
//   • X-Telegram-Bot-Api-Secret-Token must equal TELEGRAM_WEBHOOK_SECRET
//     (set when registering the webhook — see the setup card in Admin →
//     Automations). Anyone else posting here gets 401.
//   • Only messages from TELEGRAM_CHAT_ID (the owner) are answered. Any other
//     chat gets a polite "private bot" reply and nothing else.
// Commands: /stats /last /pending /cron /scout /help
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;
const env = (n: string) => process.env[n] ?? (import.meta as any).env?.[n];
const ok = () => new Response('ok', { status: 200 });

async function reply(chatId: string | number, text: string) {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

const money = (n: number) => '$' + Number(n || 0).toFixed(2);
const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

async function cmdStats(db: any): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ count: pv }, { data: ordersToday }, { data: orders7 }, { data: evs }, { count: onSite }] = await Promise.all([
    db.from('site_visits').select('id', { count: 'exact', head: true }).eq('day', today),
    db.from('orders').select('total').eq('status', 'paid').gte('created_at', today + 'T00:00:00Z'),
    db.from('orders').select('total').eq('status', 'paid').gte('created_at', since7),
    db.from('site_events').select('type').eq('day', today).limit(5000),
    db.from('site_visits').select('id', { count: 'exact', head: true }).gte('ts', new Date(Date.now() - 5 * 60000).toISOString()),
  ]);
  const cnt = (t: string) => (evs || []).filter((e: any) => e.type === t).length;
  const revT = (ordersToday || []).reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  const rev7 = (orders7 || []).reduce((s: number, o: any) => s + Number(o.total || 0), 0);
  return `📊 <b>Today</b>
👀 ${pv || 0} pageviews · 🟢 ${onSite || 0} on site now
🛒 ${cnt('add_to_cart')} cart adds · ⚡ ${cnt('buy_now')} buy-now · ❤️ ${cnt('wishlist_add')} wishlist
🚪 ${cnt('checkout_start')} checkouts · 💳 ${cnt('txn_created')} reached payment
✅ <b>${(ordersToday || []).length} orders · ${money(revT)}</b>

📅 <b>Last 7 days:</b> ${(orders7 || []).length} orders · ${money(rev7)}`;
}

async function cmdLast(db: any): Promise<string> {
  const { data: o } = await db.from('orders').select('id, email, total, currency, created_at, order_items(title)')
    .eq('status', 'paid').order('created_at', { ascending: false }).limit(3);
  if (!o?.length) return 'No orders yet.';
  return '🧾 <b>Latest orders</b>\n' + o.map((r: any) => {
    const ago = Math.round((Date.now() - Date.parse(r.created_at)) / 3600000);
    const items = (r.order_items || []).slice(0, 3).map((i: any) => '  • ' + esc(String(i.title).split('|')[0].trim())).join('\n');
    return `\n<b>${money(r.total)} ${r.currency}</b> · ${esc(r.email)} · ${ago < 1 ? 'just now' : ago + 'h ago'}\n${items}`;
  }).join('\n');
}

async function cmdPending(db: any): Promise<string> {
  const { data: wk } = await db.from('weekly_digest_log').select('week_key, product_count, queued_count, drain_note, last_drain_at').order('week_key', { ascending: false }).limit(1).maybeSingle();
  if (!wk) return 'No weekly digest on record.';
  const [{ count: sent }, { count: pending }] = await Promise.all([
    db.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', wk.week_key).eq('status', 'sent'),
    db.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', wk.week_key).eq('status', 'pending'),
  ]);
  const { count: carts } = await db.from('abandoned_carts').select('id', { count: 'exact', head: true }).is('recovered_at', null).is('reminded_at', null);
  return `📬 <b>Weekly digest ${wk.week_key}</b>
${wk.product_count || 0} designs · ${sent || 0}/${wk.queued_count || 0} delivered${pending ? ` · <b>${pending} pending</b> (auto-retries nightly)` : ' · ✅ complete'}
${wk.drain_note ? 'Status: ' + esc(wk.drain_note) : ''}

🛒 Open carts awaiting reminder: <b>${carts || 0}</b>`;
}

async function cmdCron(db: any): Promise<string> {
  const { data: runs } = await db.from('cron_runs').select('ran_at, ok, finished_at, duration_ms, error, summary').order('ran_at', { ascending: false }).limit(3);
  if (!runs?.length) return '🔴 Nightly automation has NEVER recorded a run.';
  const r = runs[0];
  const ageH = (Date.now() - Date.parse(r.ran_at)) / 3600000;
  const state = r.ok === null ? (ageH < 0.2 ? '🟡 running now' : '🔴 started but never finished (timeout?)') : r.ok ? '🟢 ok' : '🔴 FAILED';
  const g = r.summary?.growth || {};
  const bad = Object.entries(g).filter(([, v]) => typeof v === 'string' && /^(failed|skipped)/i.test(v as string)).map(([k, v]) => `  ⚠️ ${k}: ${esc(v)}`);
  return `⏱ <b>Nightly automation</b>
Last run: ${Math.round(ageH * 10) / 10}h ago · ${state}${r.duration_ms ? ` · ${Math.round(r.duration_ms / 1000)}s` : ''}
${r.error ? '❌ ' + esc(r.error) : ''}${bad.length ? '\n' + bad.join('\n') : ''}
Runs on record: ${runs.length}`;
}

async function cmdScout(db: any): Promise<string> {
  // Kick the Design Scout NOW (regardless of Monday) by running just that
  // step logic inline is heavy; instead we flag a one-shot request that the
  // next daily run honours, and tell the owner. Keeps this handler fast.
  await db.from('growth_settings').update({ design_scout_enabled: true }).eq('id', 1);
  const { data: last } = await db.from('email_send_log').select('sent_at').eq('kind', 'designScout').order('sent_at', { ascending: false }).limit(1).maybeSingle();
  return `🧭 Design Scout is <b>ON</b>. It runs every Monday with the nightly automation.${last ? `\nLast report sent ${new Date(last.sent_at).toLocaleDateString()}.` : '\nNo report sent yet — first one lands next Monday.'}`;
}

const HELP = `🤖 <b>DigitalChiselCo bot</b>
/stats — today's traffic, shopper actions, orders
/last — latest 3 orders
/pending — weekly digest delivery + open carts
/cron — nightly automation health
/scout — Design Scout status
/help — this list`;

export const POST: APIRoute = async ({ request }) => {
  const expected = env('TELEGRAM_WEBHOOK_SECRET') || '';
  const got = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!expected || got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return new Response('unauthorized', { status: 401 });
  }
  const update = await request.json().catch(() => null);
  const msg = update?.message || update?.edited_message;
  if (!msg?.chat?.id) return ok();
  const chatId = String(msg.chat.id);
  const owner = String(env('TELEGRAM_CHAT_ID') || '');
  if (!owner || chatId !== owner) {
    await reply(chatId, 'This is a private bot for the DigitalChiselCo owner.');
    return ok();
  }
  const text = String(msg.text || '').trim().toLowerCase();
  const cmd = text.split(/[\s@]/)[0];
  const db = supabaseAdmin();
  try {
    let out: string;
    if (cmd === '/stats') out = await cmdStats(db);
    else if (cmd === '/last') out = await cmdLast(db);
    else if (cmd === '/pending') out = await cmdPending(db);
    else if (cmd === '/cron') out = await cmdCron(db);
    else if (cmd === '/scout') out = await cmdScout(db);
    else out = HELP;
    await reply(chatId, out);
  } catch (e: any) {
    await reply(chatId, '⚠️ Command failed: ' + esc(e?.message || e));
  }
  return ok();
};
