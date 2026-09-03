// Admin: review, edit, regenerate and approve AI marketing images.
//
// Nothing generated reaches Pinterest without a human look. This endpoint backs
// the "Marketing images" card: it lists what is waiting, approves or rejects an
// image, and regenerates one from an edited scene description.
//
// Regeneration needs GEMINI_API_KEY in the site environment (Netlify). Without
// it the card still lists, approves and rejects; only the regenerate button
// reports that the key is missing, rather than failing silently.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { mockupPrompt, groupPrompt, macroPrompt, sceneForCategory, isFlatProduct } from '../../../lib/marketing-prompts.mjs';

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

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || (import.meta as any).env?.GEMINI_API_KEY;
const GEMINI_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';

async function generate(prompt: string, refs: Buffer[], aspect?: string): Promise<Buffer | null> {
  const key = GEMINI_KEY();
  if (!key) throw new Error('GEMINI_API_KEY is not set on the site, so images cannot be regenerated here.');
  const parts: any[] = refs.map((b) => ({ inlineData: { mimeType: 'image/jpeg', data: b.toString('base64') } }));
  parts.push({ text: prompt });
  const body = {
    contents: [{ parts }],
    generationConfig: { imageConfig: { imageSize: '2K', ...(aspect ? { aspectRatio: aspect } : {}) } },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j: any = await r.json();
  const ps = j?.candidates?.[0]?.content?.parts || [];
  const img = ps.find((p: any) => p.inlineData?.data || p.inline_data?.data);
  if (img) return Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64');
  throw new Error(j?.error?.message?.slice(0, 200) || 'Gemini returned no image');
}

async function fetchRef(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`reference image ${r.status}`);
  const sharp = (await import('sharp')).default;
  return sharp(Buffer.from(await r.arrayBuffer())).resize(900, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

async function store(path: string, buf: Buffer): Promise<string> {
  const db = supabaseAdmin();
  const { error } = await db.storage.from('site-media').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`upload: ${error.message}`);
  return db.storage.from('site-media').getPublicUrl(path).data.publicUrl;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const b = await request.json().catch(() => ({} as any));
  const db = supabaseAdmin();
  const action = String(b?.action || 'list');

  // ── the review queue ────────────────────────────────────────────────
  if (action === 'list') {
    const status = ['pending', 'approved', 'rejected'].includes(b?.status) ? b.status : 'pending';
    const [{ data: cats }, { data: prods }, { count: pendingP }, { count: approvedP }, { count: totalP }, { count: withMockup }] = await Promise.all([
      db.from('categories').select('id, name, slug, mockup_url, mockup_status, mockup_scene').not('mockup_url', 'is', null).eq('mockup_status', status).order('name'),
      db.from('products').select('id, title, slug, image_url, mockup_url, mockup_status, mockup_scene, etsy_sales_365')
        .not('mockup_url', 'is', null).eq('mockup_status', status).order('etsy_sales_365', { ascending: false }).limit(60),
      db.from('products').select('id', { count: 'exact', head: true }).not('mockup_url', 'is', null).eq('mockup_status', 'pending'),
      db.from('products').select('id', { count: 'exact', head: true }).not('mockup_url', 'is', null).eq('mockup_status', 'approved'),
      db.from('products').select('id', { count: 'exact', head: true }).eq('active', true),
      db.from('products').select('id', { count: 'exact', head: true }).not('mockup_url', 'is', null),
    ]);
    // Coverage of the top 100 sellers, which is the batch the owner asked for first.
    const { data: top } = await db.from('products').select('mockup_url').eq('active', true)
      .order('etsy_sales_365', { ascending: false }).limit(100);
    const topDone = (top || []).filter((t: any) => t.mockup_url).length;
    return json({
      ok: true,
      categories: cats || [],
      products: prods || [],
      stats: {
        pending: pendingP || 0, approved: approvedP || 0,
        total: totalP || 0, withMockup: withMockup || 0,
        topDone, topTotal: (top || []).length,
      },
      canRegenerate: !!GEMINI_KEY(),
    });
  }

  // ── bulk review: approving 200 images one at a time is not a workflow ──
  if (action === 'approve_many' || action === 'reject_many') {
    const status = action === 'approve_many' ? 'approved' : 'rejected';
    const items: { id: string; kind?: string }[] = Array.isArray(b?.items) ? b.items.slice(0, 500) : [];
    if (!items.length) return json({ error: 'no items' }, 400);
    const prodIds = items.filter((i) => i.kind !== 'category').map((i) => String(i.id));
    const catIds = items.filter((i) => i.kind === 'category').map((i) => String(i.id));
    let done = 0;
    if (prodIds.length) {
      const { error, count } = await db.from('products').update({ mockup_status: status }, { count: 'exact' }).in('id', prodIds);
      if (error) return json({ error: error.message }, 500);
      done += count || prodIds.length;
    }
    if (catIds.length) {
      const { error, count } = await db.from('categories').update({ mockup_status: status }, { count: 'exact' }).in('id', catIds);
      if (error) return json({ error: error.message }, 500);
      done += count || catIds.length;
    }
    return json({ ok: true, done, status });
  }

  // Approve everything still waiting, in one call.
  if (action === 'approve_all_pending') {
    const [{ count: pc }, { count: cc }] = await Promise.all([
      db.from('products').update({ mockup_status: 'approved' }, { count: 'exact' }).eq('mockup_status', 'pending').not('mockup_url', 'is', null),
      db.from('categories').update({ mockup_status: 'approved' }, { count: 'exact' }).eq('mockup_status', 'pending').not('mockup_url', 'is', null),
    ]);
    return json({ ok: true, done: (pc || 0) + (cc || 0) });
  }

  const kind = b?.kind === 'category' ? 'categories' : 'products';
  const id = String(b?.id || '');
  if (!id) return json({ error: 'id required' }, 400);

  // ── approve / reject ────────────────────────────────────────────────
  if (action === 'approve' || action === 'reject') {
    const status = action === 'approve' ? 'approved' : 'rejected';
    const { error } = await db.from(kind).update({ mockup_status: status }).eq('id', id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status });
  }

  // ── regenerate, optionally from an edited scene description ─────────
  if (action === 'regenerate') {
    const scene = String(b?.scene || '').slice(0, 1200).trim();
    try {
      if (kind === 'categories') {
        const { data: cat } = await db.from('categories').select('id, name, slug').eq('id', id).maybeSingle();
        if (!cat) return json({ error: 'collection not found' }, 404);
        const { data: rows } = await db.from('products')
          .select('title, image_url, etsy_sales_365, product_categories!inner(category_id)')
          .eq('active', true).not('image_url', 'is', null).eq('product_categories.category_id', cat.id)
          .order('etsy_sales_365', { ascending: false }).limit(40);
        const chosen = (rows || []).slice(0, 4);
        if (chosen.length < 4) return json({ error: 'this collection has fewer than four designs' }, 400);
        const flat = chosen.filter((p: any) => isFlatProduct(p.title)).length >= 2;
        const refs = await Promise.all(chosen.map((p: any) => fetchRef(p.image_url)));
        const room = scene || sceneForCategory(cat.slug);
        const out = await generate(groupPrompt(refs.length, room, flat), refs, '2:3');
        if (!out) return json({ error: 'no image returned' }, 502);
        const url = await store(`themes/${cat.slug}.jpg`, out);
        await db.from('categories').update({ mockup_url: `${url}?v=${Date.now()}`, mockup_scene: room, mockup_status: 'pending', mockup_at: new Date().toISOString() }).eq('id', id);
        return json({ ok: true, url: `${url}?v=${Date.now()}` });
      }
      const { data: p } = await db.from('products').select('id, slug, title, image_url').eq('id', id).maybeSingle();
      if (!p?.image_url) return json({ error: 'product not found' }, 404);
      const { data: pc } = await db.from('product_categories').select('categories(slug)').eq('product_id', id).limit(1);
      const catSlug = (pc?.[0] as any)?.categories?.slug || '';
      const room = scene || sceneForCategory(catSlug, isFlatProduct(p.title));
      const ref = await fetchRef(p.image_url);
      const out = await generate(mockupPrompt(room), [ref]);
      if (!out) return json({ error: 'no image returned' }, 502);
      const url = await store(`mockups/${p.slug}.jpg`, out);
      await db.from('products').update({ mockup_url: `${url}?v=${Date.now()}`, mockup_scene: room, mockup_status: 'pending' }).eq('id', id);
      return json({ ok: true, url: `${url}?v=${Date.now()}` });
    } catch (e: any) {
      return json({ error: String(e?.message || e).slice(0, 300) }, 500);
    }
  }

  return json({ error: 'unknown action' }, 400);
};
