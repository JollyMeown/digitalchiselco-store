// Admin endpoint: fetch Cults3D sales for the dashboard. The Cults API key is a
// server secret, so the admin UI calls this (gated by the admin's Supabase login)
// instead of hitting Cults directly. Returns sales rows + a summary, plus how many
// of our products we've published to Cults so far.
//
// Every call also INGESTS what it fetched (src/lib/cults.ts): new sales are
// persisted, pushed to the owner_alerts feed (chime) and Telegram, exactly
// once. So while the Cults tab is open, its 30 s refresh doubles as a poller.
//
// Requires CULTS3D_USERNAME + CULTS3D_API_KEY in the server env (Netlify).

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { cultsConfigured, fetchCultsSales, ingestCultsSales, markPoll } from '../../../lib/cults';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;

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
  if (!cultsConfigured()) {
    return json({ error: 'Cults3D API not configured on the server. Set CULTS3D_USERNAME and CULTS3D_API_KEY in Netlify env vars.' }, 503);
  }

  const admin = supabaseAdmin();
  let sales: any[] = [];
  try {
    sales = await fetchCultsSales(5000);
  } catch (e: any) {
    await markPoll(admin, false, String(e?.message || e), 'admin-tab');
    return json({ error: 'Failed to reach Cults3D', detail: String(e?.message || e) }, 502);
  }

  // Ingest + alert-once (never fails the dashboard read).
  let ingest: any = null;
  try {
    ingest = await ingestCultsSales(admin, sales, { runner: 'admin-tab' });
    await markPoll(admin, true, `${ingest.total} checked · ${ingest.inserted} new · ${ingest.alerted} alerted${ingest.seeded ? ' · seeded history silently' : ''}`, 'admin-tab');
  } catch (e: any) { console.error('[cults-sales] ingest failed:', e?.message); }

  const currency = sales[0]?.income?.currency || 'EUR';
  const totalIncome = sales.reduce((s, x) => s + (x.income?.value || 0), 0);
  const pendingPayout = sales.filter((x) => !x.payedOutAt).reduce((s, x) => s + (x.income?.value || 0), 0);

  // Cults3D doesn't expose a payout date via API; it pays out monthly (~15th).
  // Estimate the next payout day so the dashboard can show a "due date".
  const now = new Date();
  const py = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (now.getUTCDate() >= 15 ? 1 : 0), 15));
  const nextPayoutEst = pendingPayout > 0 ? py.toISOString().slice(0, 10) : null;

  // How many of our products are live on Cults so far.
  let listed = 0;
  try {
    const { count } = await admin.from('products').select('id', { count: 'exact', head: true }).not('cults3d_uploaded_at', 'is', null);
    listed = count || 0;
  } catch {}

  return json({
    ok: true,
    currency,
    totalIncome: Math.round(totalIncome * 100) / 100,
    pendingPayout: Math.round(pendingPayout * 100) / 100,
    nextPayoutEst,
    salesCount: sales.length,
    listed,
    sales,
    ingest: ingest ? { inserted: ingest.inserted, alerted: ingest.alerted, seeded: ingest.seeded } : null,
  });
};
