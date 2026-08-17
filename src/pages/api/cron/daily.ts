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
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const key = bearer || new URL(request.url).searchParams.get('key') || '';
  if (key !== secret) return json({ error: 'unauthorized' }, 401);

  const t0 = Date.now();
  // Heartbeat: record every run (ok or not) so Admin → Automations can show
  // the cron is alive. Best-effort — never affects the run itself.
  const heartbeat = async (ok: boolean, summary: any, error?: string) => {
    try {
      const { supabaseAdmin } = await import('../../../lib/supabase');
      await supabaseAdmin().from('cron_runs').insert({ ok, duration_ms: Date.now() - t0, summary, error: error ?? null });
    } catch { /* ignore */ }
  };
  try {
    const stats = await runDailyAutomation();
    // Growth systems (drip / cart reminders / followups) run after the
    // membership drops; each is individually toggled in Admin → Automations.
    let growth: Record<string, any> = {};
    try { growth = await runGrowthAutomation(); }
    catch (e: any) { growth = { error: e?.message || 'growth failed' }; }
    await heartbeat(true, { stats, growth });
    return json({ ok: true, ranAt: new Date().toISOString(), stats, growth });
  } catch (e: any) {
    console.error('[cron/daily] failed:', e);
    await heartbeat(false, null, e?.message || 'automation failed');
    return json({ ok: false, error: e?.message || 'automation failed' }, 500);
  }
}

export const GET: APIRoute = ({ request }) => handle(request);
export const POST: APIRoute = ({ request }) => handle(request);
