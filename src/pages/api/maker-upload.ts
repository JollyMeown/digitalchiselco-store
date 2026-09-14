// Public endpoint: upload one portfolio image for a maker application.
// Returns a public URL the form collects and submits with /api/maker-apply.
// Rate-limited + strict type/size checks; images land in the maker-portfolio
// bucket (public read, for the admin review and future maker profiles).
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';
import { verifyUploadToken, verifyMakerToken } from '../../lib/marketplace-token';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const OK_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// HEIC is what an iPhone stores by default. It is refused rather than accepted
// because most browsers cannot display it, so a stored .heic would be an
// invisible photo on the public maker page: the same complaint one step later.
// The form converts to JPEG in the browser before sending, so reaching this
// message means conversion could not run, and the maker needs to know why
// rather than watch the upload fail with no reason given.
const HEIC = /^image\/(heic|heif)$/i;
const MAX_MB = 12;

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!(await rateLimit(`maker-upload:ip:${ip}`, 30, 3600))) return tooMany('Too many uploads. Please slow down.');

  const form = await request.formData().catch(() => null);
  // an upload needs a pass: either the short-lived form token from
  // /become-a-maker, or a signed-in maker's session token (progress photos)
  const t = String(form?.get('t') || '');
  if (!verifyUploadToken(t) && !verifyMakerToken(t)) return json({ error: 'Upload session expired. Please reload the page and try again.' }, 401);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided.' }, 400);
  const ext = OK_TYPES[file.type];
  if (!ext) {
    if (HEIC.test(file.type) || /\.hei[cf]$/i.test(file.name || '')) {
      return json({ error: 'This is an iPhone HEIC photo, which most browsers cannot display. On your iPhone open Settings > Camera > Formats and choose "Most Compatible", then take or re-save the photo. Emailing it to yourself also converts it to JPG.' }, 400);
    }
    return json({ error: `That file is a ${file.type || 'unknown type'}. Please upload a JPG, PNG or WebP image.` }, 400);
  }
  if (file.size > MAX_MB * 1024 * 1024) return json({ error: `Image is ${(file.size / 1048576).toFixed(1)} MB, over the ${MAX_MB} MB limit. Please use a smaller one.` }, 400);

  const rand = Math.random().toString(36).slice(2, 12);
  const objectPath = `applications/${new Date().toISOString().slice(0, 10)}/${rand}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const db = supabaseAdmin();
  const { error } = await db.storage.from('maker-portfolio').upload(objectPath, bytes, { contentType: file.type, upsert: false });
  if (error) { console.error('[maker-upload]', error.message); return json({ error: 'Upload failed. Please try again.' }, 500); }

  return json({ ok: true, url: `${SUPABASE_URL}/storage/v1/object/public/maker-portfolio/${objectPath}` });
};
