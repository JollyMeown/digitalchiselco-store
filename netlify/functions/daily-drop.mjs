// Netlify Scheduled Function — the nightly TRIGGER. Fires the background
// runner (netlify/functions/daily-run-background.mjs), which does the actual
// work under a 15-minute limit. This function itself returns in ~1 s.
//
// History: this used to call the SSR route /api/cron/daily and WAIT for it.
// That route runs inside Astro's synchronous server function (10 s cap); a
// cold DB + email sends took longer, the run was killed before its heartbeat,
// and the admin showed "never ran". Delegating to a background function fixes
// the ceiling for good. Non-200 from the trigger step pings the owner.
//
// Schedule: 08:00 UTC daily. Change the cron below + redeploy to adjust.
export const config = { schedule: '0 8 * * *' };

export default async () => {
  const site = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[daily-drop] CRON_SECRET not set — skipping');
    return new Response('missing CRON_SECRET', { status: 200 });
  }
  try {
    const res = await fetch(`${site}/.netlify/functions/daily-run-background`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(20000),
    });
    // Background functions ack with 202 immediately and keep running.
    console.log('[daily-drop] triggered background run →', res.status);
    if (res.status !== 202 && res.status !== 200) {
      await notify(`🔴 <b>Nightly trigger failed</b>\nBackground runner answered HTTP ${res.status}`);
    }
  } catch (e) {
    console.error('[daily-drop] trigger failed', e);
    await notify(`🔴 <b>Nightly trigger failed</b>\n${String(e?.message || e).slice(0, 200)}`);
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
