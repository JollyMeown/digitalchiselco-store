// Public directory data for the Cut Local maker map: approved makers only,
// SAFE fields only (no email/phone/postal). Used by the animated /makers map.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' } });

export const GET: APIRoute = async () => {
  const db = supabaseAdmin();
  const { data } = await db.from('makers')
    .select('id, maker_name, city, region, country, rating_avg, rating_count, jobs_completed, machine_types, portfolio_urls')
    .eq('status', 'approved').limit(2000);
  const makers = (data || []).map((m: any) => ({
    id: m.id, name: m.maker_name, city: m.city, region: m.region, country: m.country,
    rating: Number(m.rating_avg) || 0, reviews: m.rating_count || 0, jobs: m.jobs_completed || 0,
    machines: m.machine_types || [], photo: (m.portfolio_urls || [])[0] || null,
  }));
  return json({ ok: true, count: makers.length, makers });
};
