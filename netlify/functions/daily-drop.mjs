// Netlify Scheduled Function — the nightly TRIGGER (08:00 UTC).
//
// Belt AND braces:
//   1. Trigger the BACKGROUND runner (15-min limit) — the preferred path.
//   2. Wait ~90 s and check cron_runs for a fresh heartbeat. If none appeared
//      (background function unhealthy for any reason), fall back to calling
//      the SSR route /api/cron/daily directly, which is proven to work when the
//      DB is warm and has its own start/finish heartbeat + time budget.
//   3. Ping the owner on Telegram if BOTH paths fail.
// So the automation runs tomorrow no matter which path is healthy, and no
// failure is ever silent.
import { createClient } from '@supabase/supabase-js';

export const config = { schedule: '0 8 * * *' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async () => {
  const site = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[daily-drop] CRON_SECRET not set — skipping');
    await notify('🔴 <b>Nightly trigger: CRON_SECRET not set</b>');
    return new Response('missing CRON_SECRET', { status: 200 });
  }
  const startedAt = new Date().toISOString();

  // ── 1) preferred: background runner ──
  let bgOk = false;
  try {
    const res = await fetch(`${site}/.netlify/functions/daily-run-background`, {
      method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20000),
    });
    console.log('[daily-drop] background trigger →', res.status);
    bgOk = res.status === 202 || res.status === 200;
  } catch (e) { console.error('[daily-drop] background trigger failed', e?.message); }

  // ── 2) verify a heartbeat appeared; else fall back to the SSR route ──
  let heartbeat = false;
  if (bgOk && process.env.PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await sleep(90000);
    try {
      const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { data } = await db.from('cron_runs').select('id').gte('ran_at', startedAt).limit(1);
      heartbeat = !!(data && data.length);
      console.log('[daily-drop] heartbeat after background trigger:', heartbeat);
    } catch (e) { console.error('[daily-drop] heartbeat check failed', e?.message); }
  }
  if (!heartbeat) {
    console.warn('[daily-drop] no background heartbeat — falling back to SSR /api/cron/daily');
    try {
      const res = await fetch(`${site}/api/cron/daily`, { method: 'GET', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(28000) });
      const body = await res.text().catch(() => '');
      console.log('[daily-drop] SSR fallback →', res.status, body.slice(0, 300));
      if (res.status !== 200) await notify(`🔴 <b>Nightly run failed on BOTH paths</b>\nBackground: no heartbeat · SSR: HTTP ${res.status}`);
      else await notify(`🟡 <b>Nightly run used the fallback path</b>\nBackground runner gave no heartbeat; SSR route completed. Worth a look at the Netlify function logs.`);
    } catch (e) {
      console.error('[daily-drop] SSR fallback failed', e?.message);
      await notify(`🔴 <b>Nightly run failed on BOTH paths</b>\n${String(e?.message || e).slice(0, 200)}`);
    }
  }
  return new Response('ok', { status: 200 });
};

async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch { /* best-effort */ }
}
