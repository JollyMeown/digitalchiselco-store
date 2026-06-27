// Admin endpoint: package a bundle into a single ZIP file containing all
// gallery images, a JSON manifest, a plain-text product list, and the
// Drive download URLs. Auth: requires the caller's Supabase session to
// be flagged is_admin via the profile (we pass through the bearer token).

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { ZipBuilder } from '../../../lib/zip';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;

function bad(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });
}

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  // Use service role to read the profile (RLS would block self-read with anon)
  const admin = supabaseAdmin();
  const { data: prof } = await admin.from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

function safeFile(name: string, fallback = 'file'): string {
  return (name || fallback).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120);
}

export const GET: APIRoute = async ({ url, request }) => {
  const bundleId = url.searchParams.get('id');
  if (!bundleId) return bad(400, 'Missing ?id=<bundleId>');

  // Auth — admin only. The bundle has Drive URLs, which are server-only.
  const okAdmin = await isCallerAdmin(request);
  if (!okAdmin) return bad(401, 'Admin authentication required.');

  const db = supabaseAdmin();
  const { data: bundle, error: bErr } = await db
    .from('products')
    .select('id,title,slug,description,price_usd,image_url,gallery,is_bundle,bundle_items!bundle_items_bundle_product_id_fkey(sort_order,products:source_product_id(id,title,slug,price_usd))')
    .eq('id', bundleId).maybeSingle();
  if (bErr || !bundle) return bad(404, 'Bundle not found.');

  const items = ((bundle as any).bundle_items || []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order);
  const sourceIds = items.map((it: any) => it.products?.id).filter(Boolean);

  // Drive download links (server-only RLS)
  const { data: downloads } = sourceIds.length
    ? await db.from('product_downloads').select('product_id,download_link,file_name').in('product_id', sourceIds)
    : { data: [] as any[] };
  const linksByProduct: Record<string, { name?: string; url: string }[]> = {};
  for (const d of (downloads || []) as any[]) {
    (linksByProduct[d.product_id] ||= []).push({ name: d.file_name || undefined, url: d.download_link });
  }

  // The bundle's own download links (when populated by Bundle Composer save())
  const { data: bundleDownloads } = await db.from('product_downloads').select('download_link,file_name').eq('product_id', bundle.id);

  const zip = new ZipBuilder();
  const folder = safeFile(bundle.slug || bundle.id, 'bundle');

  // 1) Gallery images
  const gallery: string[] = Array.isArray((bundle as any).gallery) ? (bundle as any).gallery : [];
  const allImages = bundle.image_url && !gallery.includes(bundle.image_url) ? [bundle.image_url, ...gallery] : gallery;
  let imgIdx = 1;
  for (const url of allImages) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      const extMatch = url.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
      const ext = (extMatch?.[1] || 'jpg').toLowerCase();
      zip.add(`${folder}/images/${String(imgIdx).padStart(2, '0')}.${ext}`, buf);
      imgIdx++;
    } catch { /* skip bad image */ }
  }

  // 2) Plain-text README
  const lines: string[] = [];
  lines.push(`Bundle: ${bundle.title}`);
  lines.push(`Slug:   ${bundle.slug}`);
  lines.push(`Price:  $${Number(bundle.price_usd).toFixed(2)} USD`);
  lines.push(`Items:  ${items.length}`);
  lines.push('');
  lines.push('Description');
  lines.push('-----------');
  lines.push(bundle.description || '(no description)');
  lines.push('');
  lines.push('Source products');
  lines.push('---------------');
  items.forEach((it: any, i: number) => {
    const p = it.products;
    lines.push(`${i + 1}. ${p?.title || '(unknown)'} — $${Number(p?.price_usd || 0).toFixed(2)}`);
    lines.push(`   slug: ${p?.slug || ''}`);
    const ls = linksByProduct[p?.id || ''] || [];
    if (ls.length === 0) lines.push('   drive: (no link attached)');
    else ls.forEach((l) => lines.push(`   drive: ${l.url}`));
    lines.push('');
  });
  if ((bundleDownloads || []).length) {
    lines.push('Direct bundle download URLs');
    lines.push('---------------------------');
    for (const d of bundleDownloads!) lines.push(`- ${d.download_link}`);
    lines.push('');
  }
  zip.add(`${folder}/README.txt`, lines.join('\r\n'));

  // 3) JSON manifest (machine-readable)
  const manifest = {
    id: bundle.id,
    title: bundle.title,
    slug: bundle.slug,
    description: bundle.description,
    price_usd: Number(bundle.price_usd),
    image_url: bundle.image_url,
    gallery,
    is_bundle: bundle.is_bundle,
    items: items.map((it: any) => ({
      sort_order: it.sort_order,
      product: it.products ? {
        id: it.products.id, title: it.products.title, slug: it.products.slug, price_usd: Number(it.products.price_usd),
        drive_links: linksByProduct[it.products.id] || [],
      } : null,
    })),
    bundle_downloads: (bundleDownloads || []).map((d: any) => ({ file_name: d.file_name, url: d.download_link })),
    exported_at: new Date().toISOString(),
  };
  zip.add(`${folder}/manifest.json`, JSON.stringify(manifest, null, 2));

  // 4) Drive URLs as a simple text file
  const driveLines: string[] = [];
  items.forEach((it: any) => {
    const p = it.products;
    const ls = linksByProduct[p?.id || ''] || [];
    for (const l of ls) driveLines.push(`${p?.title || ''}\t${l.url}`);
  });
  zip.add(`${folder}/drive-urls.tsv`, driveLines.join('\r\n') || '(no Drive URLs attached)');

  const body = zip.finalize();
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${folder}.zip"`,
      'content-length': String(body.length),
      'cache-control': 'no-store',
    },
  });
};
