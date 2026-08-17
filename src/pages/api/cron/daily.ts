// Daily membership automation endpoint. Called once a day by the Netlify
// scheduled function (netlify/functions/daily-drop.mjs), which passes the
// CRON_SECRET as a Bearer token. Also runnable manually for testing:
//   curl -X POST https://digitalchiselco.com/api/cron/daily -H "authorization: Bearer <CRON_SECRET>"
//
// Sends: monthly drops on due dates, pre-expiry reminders (7 days out), and
// expiry emails. Idempotent — safe to hit more than once a day.

import type { APIRoute } from 'astro';
import { runDailyAutomation } from '../../../lib/subscriptions';
import { runGrowthAutomation } from '../../../lib/growth';

export const prerender = false;

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function handle(request: Request): Promise<Response> {
  const secret = env('CRON_SECRET');
  if (!secret) return json({ error: 'CRON_SECRET not configured' }, 503);
  // Bearer header ONLY (the old ?key= fallback put the secret in URL logs);
  // constant-time compare so timing can't leak the secret.
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const crypto = await import('node:crypto');
  const A = Buffer.from(bearer), B = Buffer.from(secret);
  if (!bearer || A.length !== B.length || !crypto.timingSafeEqual(A, B)) return json({ error: 'unauthorized' }, 401);

  const t0 = Date.now();
  // Heartbeat: a row is written at START (ok=null) and finalized at the end.
  // A serverless timeout mid-run therefore shows as "started, never finished"
  // in Admin → Automations — distinguishable from "scheduler never fired"
  // (which is how a dead cron hid for 11 days). Best-effort, never blocks.
  let runId: number | null = null;
  const { supabaseAdmin } = await import('../../../lib/supabase');
  const { telegramOwner } = await import('../../../lib/notify');
  try {
    const { data } = await supabaseAdmin().from('cron_runs').insert({ ok: null, summary: { started: true } }).select('id').single();
    runId = data?.id ?? null;
  } catch { /* ignore */ }
  const finish = async (ok: boolean, summary: any, error?: string) => {
    try {
      const row = { ok, duration_ms: Date.now() - t0, summary, error: error ?? null, finished_at: new Date().toISOString() };
      if (runId) await supabaseAdmin().from('cron_runs').update(row).eq('id', runId);
      else await supabaseAdmin().from('cron_runs').insert(row);
    } catch { /* ignore */ }
  };
  try {
    const stats = await runDailyAutomation();
    // Growth systems (drip / cart reminders / followups) run after the
    // membership drops; each is individually toggled in Admin → Automations.
    let growth: Record<string, any> = {};
    try { growth = await runGrowthAutomation(); }
    catch (e: any) { growth = { error: e?.message || 'growth failed' }; }
    await finish(true, { stats, growth });
    // Surface silent per-step failures to the owner (email/Telegram), so a
    // step reporting `failed: …` inside a 200 response is not invisible.
    const bad = Object.entries(growth).filter(([, v]) => typeof v === 'string' && /^failed/i.test(v)).map(([k, v]) => `${k}: ${v}`);
    const failCounts = Object.entries(growth).filter(([, v]) => v && typeof v === 'object' && Number((v as any).failed) > 0).map(([k, v]) => `${k}: ${(v as any).failed} failed`);
    if (bad.length || failCounts.length || (stats as any)?.failures > 0) {
      await telegramOwner(`⚠️ <b>Nightly automation finished with issues</b>\n${[...bad, ...failCounts, (stats as any)?.failures > 0 ? `membership drops: ${(stats as any).failures} failed` : ''].filter(Boolean).join('\n')}`);
    }
    return json({ ok: true, ranAt: new Date().toISOString(), stats, growth });
  } catch (e: any) {
    console.error('[cron/daily] failed:', e);
    await finish(false, null, e?.message || 'automation failed');
    await telegramOwner(`🔴 <b>Nightly automation FAILED</b>\n${String(e?.message || e).slice(0, 300)}`);
    return json({ ok: false, error: e?.message || 'automation failed' }, 500);
  }
}

export const GET: APIRoute = ({ request }) => handle(request);
export const POST: APIRoute = ({ request }) => handle(request);
