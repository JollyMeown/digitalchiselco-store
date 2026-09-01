// Admin-triggered pull of Google Merchant Center daily performance.
// The nightly cron does this automatically; this route is the "Refresh now"
// button and, more usefully, the way to see the exact API error while setting
// the service account up.
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
  const { merchantConfigured, syncMerchantStats } = await import('../../../lib/google-merchant');
  if (!merchantConfigured()) {
    return json({ error: 'Not connected yet. Add GOOGLE_MERCHANT_ID, GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY in Netlify, then redeploy.' }, 503);
  }
  const days = Math.max(1, Math.min(180, Number(new URL(request.url).searchParams.get('days')) || 90));
  try {
    const status = await syncMerchantStats(days);
    return json({ ok: true, status });
  } catch (e: any) {
    return json({ error: String(e?.message || e).slice(0, 500) }, 500);
  }
};
