// Public directory data for the Cut Local maker map: approved makers only,
// SAFE fields only (no email/phone/postal). Used by the animated /makers map.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { img } from '../../../lib/img';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300, stale-while-revalidate=1800' } });

export const GET: APIRoute = async () => {
  const db = supabaseAdmin();
  const { data } = await db.from('makers')
    .select('id, maker_name, city, region, country, rating_avg, rating_count, jobs_completed, machine_types, portfolio_urls')
    .eq('status', 'approved').limit(2000);
  const makers = (data || []).map((m: any) => ({
    id: m.id, name: m.maker_name, city: m.city, region: m.region, country: m.country,
    rating: Number(m.rating_avg) || 0, reviews: m.rating_count || 0, jobs: m.jobs_completed || 0,
    machines: m.machine_types || [],
    // the map shows this at about 90 px in a tooltip: send that, not a 1600 px photo
    photo: img((m.portfolio_urls || [])[0], { w: 180, q: 65, square: true }) || null,
  }));
  return json({ ok: true, count: makers.length, makers });
};
