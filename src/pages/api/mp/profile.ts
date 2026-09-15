// Let an approved maker edit their own public listing.
//
// A maker wrote in (2026-09-15): "where do I go to review my name on the Maker
// listing and to edit my profile?" There was nowhere. The application form
// wrote the row once and nothing could change it afterwards except the admin.
// Same 30-day maker token as the dashboard; the row is found by the email
// inside the token, so a maker can only ever touch their own listing.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyMakerToken } from '../../../lib/marketplace-token';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const list = (v: unknown, max: number) => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, max);

export const POST: APIRoute = async ({ request }) => {
  if (!(await rateLimit(`mp-profile:${clientIp(request)}`, 30, 3600))) return tooMany('Too many changes. Please slow down.');
  const b = await request.json().catch(() => ({} as any));
  const auth = verifyMakerToken(String(b.t || ''));
  if (!auth) return json({ error: 'Your sign-in link has expired. Please request a new one.' }, 401);

  const db = supabaseAdmin();
  const { data: maker } = await db.from('makers').select('id').eq('email', auth.email).eq('status', 'approved').maybeSingle();
  if (!maker) return json({ error: 'Maker account not found.' }, 404);

  const maker_name = str(b.maker_name, 80);
  if (maker_name.length < 2) return json({ error: 'Please give your workshop a name.' }, 400);
  const patch = {
    maker_name,
    contact_name: str(b.contact_name, 80) || null,
    bio: str(b.bio, 1200) || null,
    city: str(b.city, 80) || null,
    region: str(b.region, 80) || null,
    country: str(b.country, 80) || null,
    machine_types: list(b.machine_types, 8),
    machine_models: str(b.machine_models, 200) || null,
    materials: list(b.materials, 12),
    max_size: str(b.max_size, 80) || null,
    min_lead_days: Math.max(0, Math.min(90, Number(b.min_lead_days) || 0)) || null,
    website_url: str(b.website_url, 200) || null,
    instagram_url: str(b.instagram_url, 120) || null,
    etsy_url: str(b.etsy_url, 200) || null,
    deliver_domestic_ship: !!b.deliver_domestic_ship,
    deliver_intl: !!b.deliver_intl,
  };
  const { error } = await db.from('makers').update(patch).eq('id', maker.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
