// Admin: what Google actually does with our feed.
//
// The performance panel answers "how many clicks", which is useless when the
// answer is almost none: an item Google refuses to show never reaches a
// performance report. This answers the prior question, "is Google willing to
// show it at all", and names the issues holding items back.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

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
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const { merchantConfigured, fetchProductStatus } = await import('../../../lib/google-merchant');
  if (!merchantConfigured()) return json({ error: 'Google Merchant is not connected on this deployment.' }, 503);
  // Which account is this deployment actually reading? Neither value is a
  // secret: the merchant id is the number printed in Merchant Center's own
  // header, and the service account address is what has to be granted access
  // there. Having them on screen saves guessing when linking Google Ads.
  const account = String(process.env.GOOGLE_MERCHANT_ID || import.meta.env.GOOGLE_MERCHANT_ID || '').replace(/\D/g, '');
  const serviceAccount = String(process.env.GOOGLE_SA_EMAIL || import.meta.env.GOOGLE_SA_EMAIL || '');
  try {
    return json({ ok: true, account, serviceAccount, ...(await fetchProductStatus()), fetchedAt: new Date().toISOString() });
  } catch (e: any) {
    return json({ error: String(e?.message || e).slice(0, 500) }, 502);
  }
};
