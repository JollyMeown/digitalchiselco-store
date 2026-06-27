// Admin endpoint: bulk-import products from a CSV. Accepts text/csv body.
// Required column: title. Optional: price_usd, slug, description, image_url,
// gallery (semicolon-separated URLs), categories (semicolon-separated names —
// matched by name OR slug), download_link, is_bundle, is_bestseller, active.
// Returns { ok, summary: { created, updated, skipped, errors[] } }.

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

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

// Tiny RFC 4180-ish CSV parser. Handles "quoted, fields", escaped "" quotes,
// CR/LF newlines, leading BOM. Returns array of rows-of-cells.
function parseCsv(input: string): string[][] {
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\r') { /* swallow; LF handles newline */ }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

function truthy(v: string | undefined): boolean {
  return /^(1|true|yes|y|on)$/i.test((v || '').trim());
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);

  const ctype = request.headers.get('content-type') || '';
  let text = '';
  if (ctype.includes('text/csv') || ctype.includes('text/plain')) {
    text = await request.text();
  } else if (ctype.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'Form field "file" must be a CSV upload.' }, 400);
    text = await file.text();
  } else {
    text = await request.text();
  }
  if (!text.trim()) return json({ error: 'Empty CSV.' }, 400);

  const rows = parseCsv(text);
  if (rows.length < 2) return json({ error: 'CSV must have a header row and at least one data row.' }, 400);

  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => { idx[h] = i; });

  if (idx.title == null) {
    return json({ error: 'CSV is missing a required "title" column.', got_headers: headers }, 400);
  }

  const db = supabaseAdmin();

  // Pre-fetch all category names+slugs once so we can resolve them per row.
  const { data: cats } = await db.from('categories').select('id,name,slug');
  const catByName: Record<string, string> = {};
  for (const c of (cats || []) as any[]) {
    catByName[c.name.trim().toLowerCase()] = c.id;
    catByName[c.slug.trim().toLowerCase()] = c.id;
  }

  const summary = { created: 0, updated: 0, skipped: 0, errors: [] as { row: number; error: string }[] };

  // Process row-by-row so partial CSVs still land everything before the error.
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => !c.trim())) continue;
    const get = (k: string): string => (idx[k] != null ? (row[idx[k]] || '').trim() : '');
    const title = get('title');
    if (!title) { summary.skipped++; continue; }

    const slug = get('slug') || slugify(title);
    const priceStr = get('price_usd') || get('price');
    const description = get('description');
    const image_url = get('image_url') || get('image');
    const galleryRaw = get('gallery');
    const gallery = galleryRaw ? galleryRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : null;
    const downloadLink = get('download_link') || get('drive_link') || get('drive');
    const categoryNames = (get('categories') || get('category'))
      .split(/[;|]/).map((s) => s.trim()).filter(Boolean);

    const payload: any = {
      title,
      slug,
      price_usd: Number(priceStr) || 0,
      description: description || null,
      image_url: image_url || null,
      gallery: gallery && gallery.length ? gallery : (image_url ? [image_url] : null),
      is_bundle: truthy(get('is_bundle')),
      is_bestseller: truthy(get('is_bestseller')),
      active: get('active') === '' ? true : truthy(get('active')),
    };
    // SEO fields
    const seoTitle = get('seo_title');
    const seoDesc = get('seo_description');
    if (seoTitle) payload.seo_title = seoTitle;
    if (seoDesc) payload.seo_description = seoDesc;

    // Upsert by slug
    let productId: string | null = null;
    const { data: existing } = await db.from('products').select('id').eq('slug', slug).maybeSingle();
    if (existing?.id) {
      const { error } = await db.from('products').update(payload).eq('id', existing.id);
      if (error) { summary.errors.push({ row: r + 1, error: error.message }); continue; }
      productId = existing.id;
      summary.updated++;
    } else {
      const { data: created, error } = await db.from('products').insert(payload).select('id').single();
      if (error) { summary.errors.push({ row: r + 1, error: error.message }); continue; }
      productId = created.id;
      summary.created++;
    }

    // Categories — resolve by name OR slug; silently skip unknown ones
    if (categoryNames.length && productId) {
      const catIds = categoryNames.map((n) => catByName[n.toLowerCase()]).filter(Boolean);
      if (catIds.length) {
        // Replace existing category links to avoid stale links from older imports
        await db.from('product_categories').delete().eq('product_id', productId);
        await db.from('product_categories').upsert(
          catIds.map((category_id) => ({ product_id: productId!, category_id })),
          { onConflict: 'product_id,category_id' },
        );
      }
    }

    // Download link
    if (downloadLink && productId) {
      // Replace existing downloads for this product
      await db.from('product_downloads').delete().eq('product_id', productId);
      await db.from('product_downloads').insert({
        product_id: productId,
        download_link: downloadLink,
        drive_file_id: (downloadLink.match(/[?&]id=([^&]+)/) || [])[1] || null,
        sort_order: 0,
      });
    }
  }

  return json({ ok: true, summary });
};
