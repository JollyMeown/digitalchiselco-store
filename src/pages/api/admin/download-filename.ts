// Admin: ask Google Drive what a download link is actually called.
//
// When two products share one file, the file's own name says which of them it
// belongs to, and therefore which one is shipping the wrong model. Nothing else
// in our data can settle that: both rows look identical and both products look
// healthy. Verified on 2026-09-10, where the name behind one link read "Tree of
// Life Tortoise" while one of the two products attached to it was a whale
// scene.
//
// Only the name is fetched, never the file: a one-byte range request makes
// Drive answer with the Content-Disposition header and nothing else, so a
// 100 MB model costs a header round trip. Six links per call keeps the whole
// thing inside the function's time limit; the caller walks through in chunks.
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

async function filenameOf(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { range: 'bytes=0-0' }, signal: ctrl.signal });
    const cd = r.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    return m ? decodeURIComponent(m[1]).trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const body = await request.json().catch(() => ({} as any));
    const links = Array.isArray(body?.links) ? body.links.map(String).filter((u: string) => /^https?:\/\//i.test(u)).slice(0, 6) : [];
    if (!links.length) return json({ error: 'links[] required (http urls, up to 6 per call)' }, 400);
    const names = await Promise.all(links.map(async (url: string) => ({ url, filename: await filenameOf(url) })));
    return json({ ok: true, names });
  } catch (e: any) {
    return json({ error: e?.message || 'lookup failed' }, 500);
  }
};
