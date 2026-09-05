// Search Console ownership for the service account, by DNS.
//
// GET  -> the TXT record Google wants to see on the domain
// POST -> ask Google to check the record; on success the service account is
//         a verified owner of the domain property and the sync can run.
// Exists because Search Console's Add-user dialog rejects service accounts
// with "email not found" (Google bug, spring 2026).
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
  const { gscConfigured, gscVerificationToken, gscDomain } = await import('../../../lib/search-console');
  if (!gscConfigured()) return json({ error: 'GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY are not set in Netlify.' }, 503);
  try {
    const token = await gscVerificationToken();
    return json({ ok: true, domain: gscDomain(), record: { type: 'TXT', host: '@', value: token } });
  } catch (e: any) {
    return json({ error: String(e?.message || e).slice(0, 600) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'unauthorized' }, 401);
  const { gscConfigured, gscVerifyDomain } = await import('../../../lib/search-console');
  if (!gscConfigured()) return json({ error: 'GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY are not set in Netlify.' }, 503);
  try {
    const status = await gscVerifyDomain();
    return json({ ok: true, status });
  } catch (e: any) {
    return json({ error: String(e?.message || e).slice(0, 600) }, 500);
  }
};
