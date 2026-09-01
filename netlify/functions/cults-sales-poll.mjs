// Netlify Scheduled Function: poll Cults3D for new sales every 10 minutes.
// New sale → row in cults_sales + owner_alerts (rings the admin dashboard)
// + one Telegram message. Idempotent: alerts are claimed atomically per sale,
// so this can run alongside the admin tab's refresh or a local poller safely.
// Heartbeat in poll_status (key 'cults_sales') feeds the System-health tile.
import { createClient } from '@supabase/supabase-js';
import { pollCultsSales } from '../../src/lib/cults.ts';
import { sweepUnsentOrderConfirmations } from '../../src/lib/order-email.ts';

export const config = { schedule: '*/10 * * * *' };

export default async () => {
  const url = process.env.PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('[cults-poll] missing Supabase env'); return new Response('missing env', { status: 200 }); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  try {
    const r = await pollCultsSales(db, 'netlify-scheduled');
    console.log('[cults-poll]', JSON.stringify({ ok: r.ok, total: r.total, inserted: r.inserted, alerted: r.alerted, seeded: r.seeded, error: r.error }));
  } catch (e) {
    console.error('[cults-poll] crashed', e?.message || e);
  }
  // Piggyback: every 10 minutes, resend any paid order whose confirmation
  // email never went out (quota outage, crash, ...). Buyer emails are the
  // top priority — this retries until Resend accepts, then Telegrams you.
  try {
    const s = await sweepUnsentOrderConfirmations(db, 5);
    if (s.checked) console.log('[order-email-sweep]', JSON.stringify(s));
  } catch (e) {
    console.error('[order-email-sweep] crashed', e?.message || e);
  }
  // Piggyback watchdog: if the NIGHTLY automation hasn't completed a run in
  // over 26h the scheduler itself is dead (the failure mode of Aug 6-17,
  // when Astro CSRF silently 403'd it for 11 days) — Telegram the owner,
  // at most once per UTC day (deduped via growth_settings.cron_watchdog_day).
  try {
    const { data: lastRun } = await db.from('cron_runs').select('ran_at').order('ran_at', { ascending: false }).limit(1).maybeSingle();
    const ageH = lastRun ? (Date.now() - Date.parse(lastRun.ran_at)) / 3600000 : Infinity;
    if (ageH > 26) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: gs } = await db.from('growth_settings').select('cron_watchdog_day').eq('id', 1).maybeSingle();
      if (gs && gs.cron_watchdog_day !== today) {
        await db.from('growth_settings').update({ cron_watchdog_day: today }).eq('id', 1);
        const { telegramOwner } = await import('../../src/lib/notify.ts');
        await telegramOwner(`🔴 <b>Nightly automation has NOT run for ${Math.round(ageH)}h</b>\nThe scheduler may be dead. Emails (digest, drips, maker invites) are not going out. Check Netlify scheduled functions + admin Automations lights.`);
        console.error('[cron-watchdog] nightly automation overdue', Math.round(ageH) + 'h');
      }
    }
  } catch (e) {
    console.error('[cron-watchdog] crashed', e?.message || e);
  }
  return new Response('ok', { status: 200 });
};
