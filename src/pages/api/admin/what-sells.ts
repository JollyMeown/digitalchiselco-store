// Admin: the What Sells report (lib/what-sells.ts), recomputed from live data.
// It reads every active product and every Etsy listing stat, so the result is
// kept for 10 minutes; ?fresh=1 (the tab's Refresh button) recomputes now.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { computeWhatSells, type WhatSells } from '../../../lib/what-sells';

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

let cache: { at: number; data: WhatSells } | null = null;

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    if (!cache || url.searchParams.get('fresh') === '1' || Date.now() - cache.at > 10 * 60_000) {
      cache = { at: Date.now(), data: await computeWhatSells(supabaseAdmin()) };
    }
    return json(cache.data);
  } catch (e: any) {
    return json({ error: e?.message || 'Could not build the report.' }, 500);
  }
};
