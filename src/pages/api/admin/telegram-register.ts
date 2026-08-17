// Admin one-tap: register (or check) the Telegram bot webhook so /stats etc.
// work. Uses TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET from env; the
// secret is what Telegram will send back on every update and what
// /api/telegram/webhook verifies. Admin-gated.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const env = (n: string) => process.env[n] ?? (import.meta as any).env?.[n];
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  const { data: prof } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const token = env('TELEGRAM_BOT_TOKEN'), secret = env('TELEGRAM_WEBHOOK_SECRET');
  if (!token) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not set in Netlify.' });
  if (!secret) return json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET is not set in Netlify — add any long random string (e.g. 32+ chars), redeploy, then tap again.' });
  const site = (env('PUBLIC_SITE_URL') || 'https://digitalchiselco.com').replace(/\/$/, '');
  const url = `${site}/api/telegram/webhook`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!d.ok) return json({ ok: false, error: 'Telegram rejected: ' + (d.description || r.status) });
    // also set the command menu so they show as buttons in Telegram
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commands: [
        { command: 'stats', description: "Today's traffic, actions, orders" },
        { command: 'last', description: 'Latest 3 orders' },
        { command: 'pending', description: 'Weekly digest delivery + open carts' },
        { command: 'cron', description: 'Nightly automation health' },
        { command: 'scout', description: 'Design Scout status' },
        { command: 'help', description: 'Command list' },
      ] }),
    }).catch(() => {});
    return json({ ok: true, message: `Webhook registered → ${url}. Open your bot in Telegram and send /stats.` });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'network error' });
  }
};
