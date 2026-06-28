// Admin endpoint: fetch Cults3D sales for the dashboard. The Cults API key is a
// server secret, so the admin UI calls this (gated by the admin's Supabase login)
// instead of hitting Cults directly. Returns sales rows + a summary, plus how many
// of our products we've published to Cults so far.
//
// Requires CULTS3D_USERNAME + CULTS3D_API_KEY in the server env (Netlify).

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const CULTS_USER = process.env.CULTS3D_USERNAME || import.meta.env.CULTS3D_USERNAME || '';
const CULTS_KEY = process.env.CULTS3D_API_KEY || import.meta.env.CULTS3D_API_KEY || '';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  const admin = supabaseAdmin();
  const { data: prof } = await admin.from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'unauthorized' }, 401);
  if (!CULTS_USER || !CULTS_KEY) {
    return json({ error: 'Cults3D API not configured on the server. Set CULTS3D_USERNAME and CULTS3D_API_KEY in Netlify env vars.' }, 503);
  }

  const authHeader = 'Basic ' + Buffer.from(`${CULTS_USER}:${CULTS_KEY}`).toString('base64');
  const gql = async (query: string) => {
    const r = await fetch('https://cults3d.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader },
      body: JSON.stringify({ query }),
    });
    return r.json();
  };

  // Pull all sales (paginated). Cults rate limit is generous for occasional admin views.
  const sales: any[] = [];
  try {
    for (let offset = 0; offset < 5000; offset += 100) {
      const q = `{ myself { salesBatch(limit:100, offset:${offset}){ total results {
        id createdAt payedOutAt
        income { value currency formatted }
        totalTaxed { value formatted }
        commission { value formatted }
        orderCountry { name code }
        creation { name slug url(locale:EN) }
      } } } }`;
      const d = await gql(q);
      if (d.errors) return json({ error: 'Cults3D API error', detail: d.errors }, 502);
      const batch = d.data?.myself?.salesBatch?.results || [];
      sales.push(...batch);
      if (batch.length < 100) break;
    }
  } catch (e: any) {
    return json({ error: 'Failed to reach Cults3D', detail: String(e?.message || e) }, 502);
  }

  // Newest first.
  sales.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const currency = sales[0]?.income?.currency || 'EUR';
  const totalIncome = sales.reduce((s, x) => s + (x.income?.value || 0), 0);
  const pendingPayout = sales.filter((x) => !x.payedOutAt).reduce((s, x) => s + (x.income?.value || 0), 0);

  // How many of our products are live on Cults so far.
  let listed = 0;
  try {
    const admin = supabaseAdmin();
    const { count } = await admin.from('products').select('id', { count: 'exact', head: true }).not('cults3d_uploaded_at', 'is', null);
    listed = count || 0;
  } catch {}

  return json({
    ok: true,
    currency,
    totalIncome: Math.round(totalIncome * 100) / 100,
    pendingPayout: Math.round(pendingPayout * 100) / 100,
    salesCount: sales.length,
    listed,
    sales,
  });
};
