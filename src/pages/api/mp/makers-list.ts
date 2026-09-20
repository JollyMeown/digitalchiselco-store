// Public, paged maker directory for /makers.
//
// The page used to render every approved maker in one go with their full
// photos. That was fine at one maker and slow at fifteen; the owner expects
// thousands ("this will be a hub of 1000s of makers"), so the list is paged,
// filterable and returns only what a card shows, with thumbnails already
// right-sized by the image transformer.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { img } from '../../../lib/img';
import { placeLabel } from '../../../lib/place';

export const prerender = false;
export const PAGE = 24;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), {
  status: s,
  headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120, stale-while-revalidate=600' },
});

export type Card = {
  id: string; name: string; place: string; rating: number; reviews: number; jobs: number;
  machines: string[]; materials: string[]; thumbs: string[];
};

/** One page of approved makers. Shared with the SSR first page in makers.astro. */
export async function makerPage(opts: { offset?: number; limit?: number; q?: string; machine?: string } = {}) {
  const db = supabaseAdmin();
  const limit = Math.min(PAGE, Math.max(1, Number(opts.limit) || PAGE));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const q = String(opts.q || '').trim().slice(0, 60);
  const machine = String(opts.machine || '').trim().slice(0, 30);

  let query = db.from('makers')
    .select('id, maker_name, city, region, country, rating_avg, rating_count, jobs_completed, machine_types, materials, portfolio_urls', { count: 'exact' })
    .eq('status', 'approved');
  if (q) query = query.or(`maker_name.ilike.%${q}%,city.ilike.%${q}%,region.ilike.%${q}%,country.ilike.%${q}%`);
  if (machine) query = query.contains('machine_types', [machine]);

  const { data, count } = await query
    .order('jobs_completed', { ascending: false })
    .order('rating_avg', { ascending: false })
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  const makers: Card[] = (data || []).map((m: any) => ({
    id: m.id,
    name: m.maker_name || 'Workshop',
    place: placeLabel(m, { withCountry: true }),
    rating: Number(m.rating_avg) || 0,
    reviews: m.rating_count || 0,
    jobs: m.jobs_completed || 0,
    machines: (m.machine_types || []).slice(0, 3),
    materials: (m.materials || []).slice(0, 3),
    // only what the card shows, at the size it shows it
    thumbs: (m.portfolio_urls || []).slice(0, 3).map((u: string) => img(u, { w: 400, q: 70 })),
  }));
  return { makers, total: count || makers.length, offset, limit };
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const r = await makerPage({
      offset: Number(url.searchParams.get('offset')) || 0,
      limit: Number(url.searchParams.get('limit')) || PAGE,
      q: url.searchParams.get('q') || '',
      machine: url.searchParams.get('machine') || '',
    });
    return json({ ok: true, ...r });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'could not load makers', makers: [], total: 0 }, 500);
  }
};
