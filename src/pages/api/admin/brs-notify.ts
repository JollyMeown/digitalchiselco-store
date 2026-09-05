// BRS → owner notification. BRS (the desktop app) has no Telegram credentials of
// its own; the bot token lives in Netlify env. So BRS posts here and the site
// fans out: a row in owner_alerts (the Admin chime feed) and a Telegram push.
//
// Auth: the caller must present the SUPABASE_SERVICE_ROLE_KEY as a bearer
// token. BRS already holds that key (it writes the site's tables with it), so
// this adds no new secret anywhere. Nothing else is accepted.
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { telegramOwner } from '../../../lib/notify';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || (import.meta as any).env?.SUPABASE_SERVICE_ROLE_KEY || '';

const esc = (s: string) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

export const POST: APIRoute = async ({ request }) => {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const A = Buffer.from(token), B = Buffer.from(SERVICE_KEY);
  if (!SERVICE_KEY || !token || A.length !== B.length || !crypto.timingSafeEqual(A, B)) return json({ error: 'unauthorized' }, 401);
  let body: any = {};
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const kind = String(body.kind || 'brs').slice(0, 40);
  const title = String(body.title || '').slice(0, 200);
  const text = String(body.body || '').slice(0, 3000);
  const url = body.url ? String(body.url).slice(0, 500) : null;
  if (!title) return json({ error: 'title required' }, 400);

  const admin = supabaseAdmin();
  let alertId: number | null = null;
  try {
    const { data } = await admin.from('owner_alerts')
      .insert({ kind, title, body: text || null, url, meta: { source: 'brs' } })
      .select('id').maybeSingle();
    alertId = (data as any)?.id ?? null;
  } catch (e: any) { console.error('[brs-notify] owner_alerts', e?.message); }

  const tg = await telegramOwner(`<b>${esc(title)}</b>${text ? '\n' + esc(text) : ''}${url ? '\n' + esc(url) : ''}`);
  return json({ ok: true, alert_id: alertId, telegram: tg.skipped ? 'not configured' : (tg.ok ? 'sent' : 'failed') });
};
