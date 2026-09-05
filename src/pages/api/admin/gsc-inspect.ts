// Index-coverage audit trigger. GET summarises what we know; POST hands a
// bigger slice to the background function (which has the 15-minute budget)
// using the server-side CRON_SECRET, so the browser never sees it.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

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
  if (!(await isCallerAdmin(request))) return json({ error: 'unauthorized' }, 401);
  const secret = process.env.CRON_SECRET || (import.meta as any).env?.CRON_SECRET || '';
  if (!secret) return json({ error: 'CRON_SECRET is not set in Netlify.' }, 503);
  const max = Math.max(1, Math.min(1800, Number(new URL(request.url).searchParams.get('max')) || 600));
  const site = (import.meta.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
  try {
    const r = await fetch(`${site}/.netlify/functions/gsc-inspect-background?max=${max}`, {
      method: 'POST', headers: { authorization: `Bearer ${secret}` },
    });
    // background functions ack 202 straight away and keep working
    if (r.status === 202 || r.ok) return json({ ok: true, status: `audit of up to ${max} URLs started in the background; results appear here as they land (about 2 a second)` });
    return json({ error: `background function answered ${r.status}` }, 500);
  } catch (e: any) {
    return json({ error: String(e?.message || e).slice(0, 400) }, 500);
  }
};
