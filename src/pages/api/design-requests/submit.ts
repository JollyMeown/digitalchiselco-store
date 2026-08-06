// Public: submit a design request / idea to the community board.
// Optional reference image arrives as a data URL and is uploaded via the
// service-role client (no public-write policy needed). Lands as status 'open'.
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';

export const prerender = false;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`dreq:${clientIp(request)}`, 5, 3600))) return tooMany('Too many submissions — try again later.');
    const b = await request.json().catch(() => ({}));
    const title = String(b.title || '').trim().slice(0, 120);
    const description = String(b.description || '').trim().slice(0, 1000) || null;
    const name = String(b.name || '').trim().slice(0, 60) || null;
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200) || null;
    if (title.length < 4) return json({ error: 'Give your idea a short title.' }, 400);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That email looks off.' }, 400);

    const db = supabaseAdmin();
    let image_url: string | null = null;
    const photo = typeof b.image === 'string' ? b.image : '';
    if (photo.startsWith('data:')) {
      const m = photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return json({ error: 'Unsupported image format.' }, 400);
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 5 * 1024 * 1024) return json({ error: 'Image is over 5MB.' }, 400);
      const path = `design-requests/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${EXT[m[1]] || 'jpg'}`;
      const up = await db.storage.from('site-media').upload(path, buf, { contentType: m[1], upsert: false });
      if (!up.error) image_url = db.storage.from('site-media').getPublicUrl(path).data.publicUrl;
    }

    const { data: row, error } = await db.from('design_requests')
      .insert({ title, description, name, email, image_url, status: 'open', votes: 1 })
      .select('id').single();
    if (error) { console.error('design request insert failed:', error.message); return json({ error: 'Could not save your idea.' }, 500); }
    // seed the submitter's own vote so dupes are prevented
    try {
      const voter = crypto.createHash('sha256').update(`${clientIp(request)}|${request.headers.get('user-agent') || ''}|dreq`).digest('hex').slice(0, 32);
      await db.from('design_request_votes').insert({ request_id: row.id, voter });
    } catch { /* best-effort */ }
    return json({ ok: true, id: row.id });
  } catch (e: any) {
    console.error('design request submit failed:', e);
    return json({ error: 'Could not submit your idea.' }, 500);
  }
};
