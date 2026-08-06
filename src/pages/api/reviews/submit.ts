// Customer review submission (with optional carve photo). Lands as status
// 'pending' for admin moderation — nothing shows on the site until approved.
// Photo arrives as a data URL, is size/type-checked, and uploaded to storage
// via the service-role client (so no public-write policy is needed).
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const POST: APIRoute = async ({ request }) => {
  try {
    const ip = clientIp(request);
    if (!(await rateLimit(`review:${ip}`, 5, 3600))) return tooMany('Too many reviews submitted — please try again later.');

    const b = await request.json().catch(() => ({}));
    const productId = String(b.product_id || '');
    const name = String(b.name || '').trim().slice(0, 60);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    const rating = Math.max(1, Math.min(5, Number(b.rating) || 5));
    const title = String(b.title || '').trim().slice(0, 80) || null;
    const text = String(b.text || '').trim().slice(0, 800);

    if (!UUID.test(productId)) return json({ error: 'Invalid product.' }, 400);
    if (name.length < 2) return json({ error: 'Please add your name.' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Please add a valid email.' }, 400);
    if (text.length < 8) return json({ error: 'Please write a little more in your review.' }, 400);

    const db = supabaseAdmin();
    // product must exist + be active
    const { data: prod } = await db.from('products').select('id').eq('id', productId).eq('active', true).maybeSingle();
    if (!prod) return json({ error: 'Product not found.' }, 400);

    // optional photo (data URL)
    let photo_url: string | null = null;
    const photo = typeof b.photo === 'string' ? b.photo : '';
    if (photo.startsWith('data:')) {
      const m = photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return json({ error: 'Unsupported image format.' }, 400);
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 5 * 1024 * 1024) return json({ error: 'Photo is over 5MB.' }, 400);
      const ext = EXT[m[1]] || 'jpg';
      const path = `reviews/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const up = await db.storage.from('site-media').upload(path, buf, { contentType: m[1], upsert: false });
      if (up.error) { console.error('review photo upload failed:', up.error.message); }
      else photo_url = db.storage.from('site-media').getPublicUrl(path).data.publicUrl;
    }

    const { error } = await db.from('reviews').insert({
      product_id: productId, name, email, rating, title, text,
      photo_url, source: 'website', status: 'pending', active: true, generic: false,
    });
    if (error) { console.error('review insert failed:', error.message); return json({ error: 'Could not save your review.' }, 500); }
    return json({ ok: true });
  } catch (e: any) {
    console.error('review submit failed:', e);
    return json({ error: 'Could not submit your review.' }, 500);
  }
};
