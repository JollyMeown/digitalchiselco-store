// Let an approved maker add or remove their own portfolio photos.
//
// Until now portfolio_urls could only ever be written once, by the application
// form, and there was no way to fix it afterwards. Two makers whose photos
// failed to upload during the application were left with an empty public
// profile and nothing they could do about it, which is how this came to light:
// "none of the photos I submitted are showing. Can you tell me how to add
// photos?" (Burl & Curl Woodworking, 2026-09-11).
//
// Auth is the same 30-day maker token the dashboard runs on, and the maker row
// is looked up by the email inside that token, so a maker can only ever touch
// their own row.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyMakerToken } from '../../../lib/marketplace-token';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const MAX_PHOTOS = 12;

export const POST: APIRoute = async ({ request }) => {
  if (!(await rateLimit(`mp-portfolio:${clientIp(request)}`, 60, 3600))) return tooMany('Too many changes. Please slow down.');

  const b = await request.json().catch(() => ({} as any));
  const auth = verifyMakerToken(String(b.t || ''));
  if (!auth) return json({ error: 'Your sign-in link has expired. Please request a new one.' }, 401);

  const db = supabaseAdmin();
  const { data: maker } = await db.from('makers').select('id, portfolio_urls').eq('email', auth.email).eq('status', 'approved').maybeSingle();
  if (!maker) return json({ error: 'Maker account not found.' }, 404);

  const current: string[] = Array.isArray(maker.portfolio_urls) ? maker.portfolio_urls : [];
  let next: string[];

  if (b.action === 'remove') {
    next = current.filter((u) => u !== String(b.url || ''));
  } else {
    // Only URLs from our own storage bucket: this array is rendered straight
    // into <img src> on the public profile, so an arbitrary URL here would be
    // someone else's page deciding what appears under our maker's name.
    const base = (import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '') + '/storage/v1/object/public/maker-portfolio/';
    const add = (Array.isArray(b.urls) ? b.urls : [b.url])
      .map((u: unknown) => String(u || ''))
      .filter((u: string) => u.startsWith(base) && u.length <= 500);
    if (!add.length) return json({ error: 'No valid photo to add.' }, 400);
    next = [...current, ...add.filter((u: string) => !current.includes(u))].slice(0, MAX_PHOTOS);
  }

  const { error } = await db.from('makers').update({ portfolio_urls: next }).eq('id', maker.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, portfolio_urls: next, max: MAX_PHOTOS });
};
