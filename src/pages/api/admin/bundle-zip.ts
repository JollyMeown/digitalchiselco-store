// Admin endpoint: return a tiny JSON manifest for a bundle. The browser does
// the actual ZIP packaging (fetching images directly from public Supabase
// Storage URLs). This keeps Netlify's function bandwidth flat — earlier
// implementations server-side-streamed all images and could trip
// "usage_exceeded" on busy bundles.
//
// Auth: caller must be flagged is_admin in profiles. Drive download URLs are
// server-only (RLS-protected); this endpoint reveals them only to admins.

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

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

export const GET: APIRoute = async ({ url, request }) => {
  const bundleId = url.searchParams.get('id');
  if (!bundleId) return json({ error: 'Missing ?id=<bundleId>' }, 400);
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);

  const db = supabaseAdmin();
  const { data: bundle, error: bErr } = await db
    .from('products')
    .select('id,title,slug,description,price_usd,image_url,gallery,is_bundle,bundle_items!bundle_items_bundle_product_id_fkey(sort_order,products:source_product_id(id,title,slug,price_usd))')
    .eq('id', bundleId).maybeSingle();
  if (bErr || !bundle) return json({ error: 'Bundle not found.' }, 404);

  const items = ((bundle as any).bundle_items || []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order);
  const sourceIds = items.map((it: any) => it.products?.id).filter(Boolean);

  const { data: downloads } = sourceIds.length
    ? await db.from('product_downloads').select('product_id,download_link,file_name').in('product_id', sourceIds)
    : { data: [] as any[] };
  const linksByProduct: Record<string, { name?: string | null; url: string }[]> = {};
  for (const d of (downloads || []) as any[]) {
    (linksByProduct[d.product_id] ||= []).push({ name: d.file_name || null, url: d.download_link });
  }
  const { data: bundleDownloads } = await db.from('product_downloads').select('download_link,file_name').eq('product_id', bundle.id);

  return json({
    id: bundle.id,
    title: bundle.title,
    slug: bundle.slug,
    description: bundle.description,
    price_usd: Number(bundle.price_usd),
    image_url: bundle.image_url,
    gallery: Array.isArray((bundle as any).gallery) ? (bundle as any).gallery : [],
    is_bundle: bundle.is_bundle,
    items: items.map((it: any) => ({
      sort_order: it.sort_order,
      product: it.products ? {
        id: it.products.id,
        title: it.products.title,
        slug: it.products.slug,
        price_usd: Number(it.products.price_usd),
        drive_links: linksByProduct[it.products.id] || [],
      } : null,
    })),
    bundle_downloads: (bundleDownloads || []).map((d: any) => ({ file_name: d.file_name || null, url: d.download_link })),
    generated_at: new Date().toISOString(),
  });
};
