// Admin-triggered pull of Google Search Console performance, and the setup
// helper: GET tells the panel which service-account email to add to the
// Search Console property; POST syncs and surfaces the exact API error.
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

export const GET: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'unauthorized' }, 401);
  const { gscConfigured, gscServiceAccountEmail, gscSite } = await import('../../../lib/search-console');
  return json({ ok: true, configured: gscConfigured(), sa_email: gscServiceAccountEmail(), site: gscSite() });
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'unauthorized' }, 401);
  const { gscConfigured, syncSearchConsole } = await import('../../../lib/search-console');
  if (!gscConfigured()) return json({ error: 'GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY are not set in Netlify.' }, 503);
  // this route runs in a normal function (dies at ~60 s), so the window is
  // capped and the sync stops early rather than half-writing; the nightly
  // background run has the full budget
  const days = Math.max(1, Math.min(480, Number(new URL(request.url).searchParams.get('days')) || 30));
  try {
    const status = await syncSearchConsole(days, { budgetMs: 45000 });
    return json({ ok: true, status });
  } catch (e: any) {
    return json({ error: String(e?.message || e).slice(0, 600) }, 500);
  }
};
