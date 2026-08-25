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
  return new Response('ok', { status: 200 });
};
