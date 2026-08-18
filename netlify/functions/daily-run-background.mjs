// Netlify BACKGROUND function (the "-background" suffix gives it a 15-minute
// limit instead of the 10-second cap on synchronous functions). This is where
// the nightly automation actually RUNS.
//
// Why: the SSR route /api/cron/daily lives inside Astro's synchronous server
// function. A cold Supabase project + serialized email sends need far more
// than 10 s, so the run was being killed before it could even write its
// start heartbeat — the "never ran" the health tile showed. Running the same
// code here removes the ceiling entirely; the SSR route stays as a manual
// trigger for testing.
//
// Invoked by daily-drop.mjs (the scheduler) with the CRON_SECRET, and can be
// invoked manually the same way:
//   curl -X POST https://digitalchiselco.com/.netlify/functions/daily-run-background \
//        -H "authorization: Bearer $CRON_SECRET"
// (background functions ack 202 immediately and keep working.)
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { runDailyAutomation } from '../../src/lib/subscriptions.ts';
import { runGrowthAutomation } from '../../src/lib/growth.ts';
import { telegramOwner } from '../../src/lib/notify.ts';

const env = (n) => process.env[n];

export default async (request) => {
  const secret = env('CRON_SECRET') || '';
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const A = Buffer.from(bearer), B = Buffer.from(secret);
  if (!secret || !bearer || A.length !== B.length || !crypto.timingSafeEqual(A, B)) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createClient(env('PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const t0 = Date.now();
  let runId = null;
  try {
    const { data } = await db.from('cron_runs').insert({ ok: null, summary: { started: true, runner: 'background' } }).select('id').single();
    runId = data?.id ?? null;
  } catch (e) { console.error('[daily-run] start heartbeat failed', e?.message); }
  const finish = async (ok, summary, error) => {
    try {
      const row = { ok, duration_ms: Date.now() - t0, summary, error: error ?? null, finished_at: new Date().toISOString() };
      if (runId) await db.from('cron_runs').update(row).eq('id', runId);
      else await db.from('cron_runs').insert(row);
    } catch (e) { console.error('[daily-run] finish heartbeat failed', e?.message); }
  };

  try {
    // Generous budget now that we have 15 minutes: let every step run fully.
    process.env.CRON_TIME_BUDGET_MS = process.env.CRON_TIME_BUDGET_MS || String(12 * 60 * 1000);
    const stats = await runDailyAutomation();
    let growth = {};
    try { growth = await runGrowthAutomation(); } catch (e) { growth = { error: e?.message || 'growth failed' }; }
    await finish(true, { stats, growth });
    const bad = Object.entries(growth).filter(([, v]) => typeof v === 'string' && /^failed/i.test(v)).map(([k, v]) => `${k}: ${v}`);
    const failCounts = Object.entries(growth).filter(([, v]) => v && typeof v === 'object' && Number(v.failed) > 0).map(([k, v]) => `${k}: ${v.failed} failed`);
    if (bad.length || failCounts.length || (stats?.failures > 0)) {
      await telegramOwner(`⚠️ <b>Nightly automation finished with issues</b>\n${[...bad, ...failCounts, stats?.failures > 0 ? `membership drops: ${stats.failures} failed` : ''].filter(Boolean).join('\n')}`);
    }
    console.log('[daily-run] done in', Date.now() - t0, 'ms', JSON.stringify({ stats, growth }).slice(0, 2000));
  } catch (e) {
    console.error('[daily-run] failed:', e);
    await finish(false, null, e?.message || 'automation failed');
    await telegramOwner(`🔴 <b>Nightly automation FAILED</b>\n${String(e?.message || e).slice(0, 300)}`);
  }
  return new Response('ok', { status: 200 });
};
