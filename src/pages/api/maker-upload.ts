// Public endpoint: upload one portfolio image for a maker application.
// Returns a public URL the form collects and submits with /api/maker-apply.
// Rate-limited + strict type/size checks; images land in the maker-portfolio
// bucket (public read, for the admin review and future maker profiles).
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const OK_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!(await rateLimit(`maker-upload:ip:${ip}`, 30, 3600))) return tooMany('Too many uploads. Please slow down.');

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided.' }, 400);
  const ext = OK_TYPES[file.type];
  if (!ext) return json({ error: 'Please upload a JPG, PNG or WebP image.' }, 400);
  if (file.size > 6 * 1024 * 1024) return json({ error: 'Image is over 6 MB — please use a smaller one.' }, 400);

  const rand = Math.random().toString(36).slice(2, 12);
  const objectPath = `applications/${new Date().toISOString().slice(0, 10)}/${rand}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const db = supabaseAdmin();
  const { error } = await db.storage.from('maker-portfolio').upload(objectPath, bytes, { contentType: file.type, upsert: false });
  if (error) { console.error('[maker-upload]', error.message); return json({ error: 'Upload failed. Please try again.' }, 500); }

  return json({ ok: true, url: `${SUPABASE_URL}/storage/v1/object/public/maker-portfolio/${objectPath}` });
};
