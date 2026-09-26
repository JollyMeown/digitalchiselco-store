// "What Sells": which collections, subjects and formats earn per design, where
// new designs are actually going, and what to make next. Owner, 2026-09-26:
// "make it available on the Admin dashboard so whenever I see it I can act on
// the recommendation". Recomputed from live data on every (cached) read, so
// the advice follows the sales instead of freezing on one day's snapshot.
//
// Sources: products.etsy_sales_365 (nightly Etsy sync, the only sales history
// with volume), etsy_listing_stats (views, favourites, listing date) and
// products.created_at for what was added recently.
import type { SupabaseClient } from '@supabase/supabase-js';

const DAY = 86_400_000;
/** A design is judged only after this many days on Etsy. */
const JUDGE_AFTER_DAYS = 120;

export const SUBJECTS: Record<string, RegExp> = {
  'Last Supper': /last supper/,
  'Highland cow': /highland/,
  'Whitetail deer and buck': / (deer|buck|whitetail|stag|fawn) /,
  'Face of Christ and Crucifixion': / (crucifix|crucifixion|crown of thorns|face of christ|face of jesus) /,
  'Cross': / cross /,
  'Bald eagle': / eagle /,
  'Trout and bass': / (trout|bass|fish|salmon|pike|walleye|marlin) /,
  'Moose': / moose /,
  'Elk': / elk /,
  'Pheasant, turkey, upland': / (pheasant|turkey|quail) /,
  'Cat': / (cat|cats|kitten|feline) /,
  'Bear': / (bear|bears|grizzly) /,
  'Tree of life': /tree of life/,
  'Ducks and waterfowl': / (duck|ducks|mallard|waterfowl|goose) /,
  'Cowboy and western': / (cowboy|western|rodeo|longhorn) /,
  'Dog': / (dog|retriever|labrador|shepherd|husky|terrier|dachshund|beagle|spaniel|pointer) /,
  'Horse': / (horse|horses|stallion|mustang) /,
  'Lighthouse and nautical': / (lighthouse|anchor|ship|sailboat|nautical) /,
  'Wolf': / (wolf|wolves) /,
  'Skull and gothic': / (skull|gothic|reaper) /,
  'Native American': / (native|chief|tribal) /,
  'Floral and rose': / (rose|roses|floral|flower|flowers) /,
  'Owl': / (owl|owls) /,
  'Angel': / (angel|angels) /,
  'Mary and Madonna': / (mary|madonna|virgin) /,
  'Tractor and farm': / (tractor|barn|farm) /,
  'Dragon': / dragon /,
  'Military and flag': / (flag|veteran|military|soldier) /,
};
// First match wins, so a "Serving Tray Sign" counts once, as a tray.
export const FORMATS: [string, RegExp][] = [
  ['Trays (serving, snack, valet, egg)', / (tray|platter) /],
  ['Doorbell plates', /doorbell/],
  ['Coat hangers', / hanger /],
  ['Hair forks', /hair fork/],
  ['3-stepped panels', /stepped/],
  ['Clocks', / clock /],
  ['Boxes and lids', / (box|lid) /],
  ['Coasters', / coaster /],
  ['Ornaments', / ornament /],
  ['Signs', / (sign|welcome) /],
  ['Plaques and memorials', / (plaque|memorial) /],
  ['Round and medallion panels', / (round|circle|medallion) /],
  ['Wall panels (everything else)', /./],
];
const SEASONAL = /christmas|halloween|valentine|easter|thanksgiving/i;

type Row = {
  id: string; slug: string; title: string; price: number; bundle: boolean; sales: number;
  views: number; fav: number; listedAt: number | null; createdAt: number; cats: string[]; image: string | null;
};
export type Verdict = 'more' | 'keep' | 'fewer' | 'seasonal';
export type WhatSells = {
  generatedAt: string;
  judgeAfterDays: number;
  facts: { designs: number; sales: number; zeroPct: number; judged: number; top75Share: number; avgPerDesign: number; newLast30: number; trayMultiple: number | null };
  collections: { name: string; designs: number; perDesign: number; zeroPct: number; salesShare: number; newLast30: number; newShare: number; verdict: Verdict; supply: 'under' | 'over' | 'ok' }[];
  subjects: { name: string; designs: number; perDesign: number; zeroPct: number; avgPrice: number; bestSeller: { title: string; sales: number } | null }[];
  formats: { name: string; designs: number; perMonth: number; zeroPct: number; avgPrice: number; judged: boolean; newest: string | null; readOn: string | null }[];
  brief: { proven: { name: string; count: number; why: string }[]; close: { name: string; count: number; why: string }[]; newBets: { name: string; count: number; why: string }[]; slowDown: { name: string; why: string }[] };
  followed: { inMore: number; inFewer: number; total: number };
  top: { rank: number; title: string; slug: string; sales: number; views: number; fav: number; price: number; collection: string; image: string | null }[];
};

async function fetchAll<T>(q: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
const norm = (t: string) => ' ' + String(t || '').split('|')[0].toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function computeWhatSells(db: SupabaseClient): Promise<WhatSells> {
  const now = Date.now();
  const [products, stats] = await Promise.all([
    fetchAll<any>((a, b) => db.from('products')
      .select('id, slug, title, price_usd, is_bundle, etsy_sales_365, etsy_listing_id, created_at, image_url, membership_plan_slug, product_categories(categories(name))')
      .eq('active', true).is('membership_plan_slug', null).order('id').range(a, b)),
    fetchAll<any>((a, b) => db.from('etsy_listing_stats').select('listing_id, views, favorers, listing_created').order('listing_id').range(a, b)),
  ]);
  const st = new Map(stats.map((s) => [String(s.listing_id), s]));
  const rows: Row[] = products.filter((p) => !String(p.slug).startsWith('software-')).map((p) => {
    const s = st.get(String(p.etsy_listing_id));
    const lc = s?.listing_created;
    const listedAt = lc == null ? null : typeof lc === 'number' ? lc * 1000 : Date.parse(lc);
    return {
      id: p.id, slug: p.slug, title: String(p.title).split('|')[0].trim(), price: Number(p.price_usd) || 0, bundle: !!p.is_bundle,
      sales: Number(p.etsy_sales_365) || 0, views: Number(s?.views) || 0, fav: Number(s?.favorers) || 0,
      listedAt: listedAt && !Number.isNaN(listedAt) ? listedAt : null, createdAt: Date.parse(p.created_at) || 0,
      cats: (p.product_categories || []).map((c: any) => c.categories?.name).filter(Boolean), image: p.image_url,
    };
  });

  const totalSales = rows.reduce((s, r) => s + r.sales, 0);
  const judged = rows.filter((r) => r.listedAt && now - r.listedAt >= JUDGE_AFTER_DAYS * DAY);
  const avg = judged.length ? judged.reduce((s, r) => s + r.sales, 0) / judged.length : 0;
  const recent = rows.filter((r) => now - r.createdAt < 30 * DAY);

  // Collections
  const cn = new Map<string, { n: number; sales: number; zero: number; allSales: number; recent: number }>();
  const bump = (name: string) => cn.get(name) || (cn.set(name, { n: 0, sales: 0, zero: 0, allSales: 0, recent: 0 }), cn.get(name)!);
  for (const r of judged) for (const c of r.cats) { const x = bump(c); x.n++; x.sales += r.sales; if (!r.sales) x.zero++; }
  for (const r of rows) for (const c of r.cats) bump(c).allSales += r.sales;
  for (const r of recent) for (const c of r.cats) bump(c).recent++;
  const catSalesTotal = [...cn.values()].reduce((s, x) => s + x.allSales, 0) || 1;
  const catRecentTotal = [...cn.values()].reduce((s, x) => s + x.recent, 0) || 1;
  const collections = [...cn.entries()].filter(([, x]) => x.n >= 3 || x.recent >= 3).map(([name, x]) => {
    const perDesign = x.n ? x.sales / x.n : 0;
    const verdict: Verdict = SEASONAL.test(name) ? 'seasonal' : !x.n ? 'keep' : perDesign >= avg * 1.4 ? 'more' : perDesign <= avg * 0.7 ? 'fewer' : 'keep';
    const salesShare = x.allSales / catSalesTotal, newShare = x.recent / catRecentTotal;
    const supply = verdict === 'more' && newShare < salesShare * 0.8 ? 'under' : verdict === 'fewer' && newShare > salesShare * 1.2 ? 'over' : 'ok';
    return { name, designs: x.n, perDesign: r2(perDesign), zeroPct: x.n ? Math.round((x.zero / x.n) * 100) : 0, salesShare: r1(salesShare * 100), newLast30: x.recent, newShare: r1(newShare * 100), verdict, supply } as WhatSells['collections'][number];
  }).sort((a, b) => b.perDesign - a.perDesign);

  // Subjects (singles only, judged designs)
  const singlesJudged = judged.filter((r) => !r.bundle);
  const subjects = Object.entries(SUBJECTS).map(([name, re]) => {
    const g = singlesJudged.filter((r) => re.test(norm(r.title)));
    if (g.length < 4) return null;
    const s = g.reduce((a, r) => a + r.sales, 0);
    const best = [...g].sort((a, b) => b.sales - a.sales)[0];
    return { name, designs: g.length, perDesign: r1(s / g.length), zeroPct: Math.round((g.filter((r) => !r.sales).length / g.length) * 100),
      avgPrice: r2(g.reduce((a, r) => a + r.price, 0) / g.length), bestSeller: best?.sales ? { title: best.title, sales: best.sales } : null };
  }).filter(Boolean).sort((a: any, b: any) => b.perDesign - a.perDesign) as WhatSells['subjects'];

  // Formats, per month since listing, so new formats are compared fairly
  const fg = new Map<string, Row[]>();
  for (const r of rows.filter((x) => !x.bundle)) { const hit = FORMATS.find(([, re]) => re.test(norm(r.title))); if (hit) (fg.get(hit[0]) || fg.set(hit[0], []).get(hit[0])!).push(r); }
  const perMonth = (r: Row) => r.sales / Math.min(365, (now - r.listedAt!) / DAY) * 30;
  const formats = FORMATS.map(([name]) => {
    const all = fg.get(name) || [];
    const ok = all.filter((r) => r.listedAt && now - r.listedAt >= 30 * DAY);
    const judgedF = ok.length >= 5;
    const newest = all.length ? new Date(Math.max(...all.map((r) => r.listedAt || r.createdAt))).toISOString().slice(0, 10) : null;
    const firstTooNew = all.filter((r) => !r.listedAt || now - r.listedAt < 30 * DAY).map((r) => r.listedAt || r.createdAt);
    const readOn = judgedF ? null : firstTooNew.length ? new Date(Math.min(...firstTooNew) + 60 * DAY).toISOString().slice(0, 10) : null;
    return { name, designs: all.length, perMonth: ok.length ? r2(ok.reduce((a, r) => a + perMonth(r), 0) / ok.length) : 0,
      zeroPct: ok.length ? Math.round((ok.filter((r) => !r.sales).length / ok.length) * 100) : 0,
      avgPrice: all.length ? r2(all.reduce((a, r) => a + r.price, 0) / all.length) : 0, judged: judgedF, newest, readOn };
  }).filter((f) => f.designs > 0).sort((a, b) => Number(b.judged) - Number(a.judged) || b.perMonth - a.perMonth);
  const wall = formats.find((f) => f.name.startsWith('Wall panels'))?.perMonth || 0;
  const tray = formats.find((f) => f.name.startsWith('Trays'));

  // The next-100 brief: 60 proven / 25 close / 15 new bets, from this data
  const proven = subjects.filter((s) => s.perDesign >= avg * 1.4);
  const close = subjects.filter((s) => s.perDesign < avg * 1.4 && s.perDesign >= avg);
  const share = (list: typeof subjects, total: number) => {
    const w = list.map((s) => s.perDesign * Math.sqrt(s.designs));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    return list.map((s, i) => ({ s, count: Math.max(3, Math.round((w[i] / sum) * total)) }));
  };
  const trayLine = tray?.judged && wall && tray.perMonth >= wall * 2
    ? [{ name: 'Trays of proven subjects', count: 8, why: `Trays sell ${r1(tray.perMonth / wall)}x a wall panel per design per month, at $${tray.avgPrice.toFixed(2)} on average` }] : [];
  const brief: WhatSells['brief'] = {
    proven: [...share(proven, 60 - trayLine.reduce((a, t) => a + t.count, 0)).map(({ s, count }) => ({ name: s.name, count,
      why: `${s.perDesign} sales per design a year (average ${r1(avg)})${s.bestSeller ? `; best: ${s.bestSeller.title} (${s.bestSeller.sales})` : ''}` })), ...trayLine],
    close: share(close, 25).map(({ s, count }) => ({ name: s.name, count, why: `${s.perDesign} per design, ${s.zeroPct}% sold nothing` })),
    newBets: [
      { name: 'Furniture parts (new BRS types), one matched suite first', count: 10, why: 'New category; competitors charge $100 to $144 per model' },
      { name: 'One more religious set in the Stations style (e.g. Mysteries of the Rosary)', count: 5, why: 'Religious is the biggest earner; sets sell as one bigger order' },
    ],
    slowDown: subjects.filter((s) => s.perDesign <= avg * 0.7 && s.designs >= 10).map((s) => ({ name: s.name,
      why: `${s.perDesign} per design, ${s.zeroPct}% sold nothing${s.bestSeller && s.bestSeller.sales >= 20 ? `. Exception: ${s.bestSeller.title} sells (${s.bestSeller.sales}), make more like it` : ''}` })),
  };

  const more = new Set(collections.filter((c) => c.verdict === 'more').map((c) => c.name));
  const fewer = new Set(collections.filter((c) => c.verdict === 'fewer').map((c) => c.name));
  const followed = { inMore: recent.filter((r) => r.cats.some((c) => more.has(c))).length, inFewer: recent.filter((r) => r.cats.some((c) => fewer.has(c))).length, total: recent.length };

  const topRows = rows.filter((r) => !r.bundle).sort((a, b) => b.sales - a.sales).slice(0, 75);
  return {
    generatedAt: new Date().toISOString(),
    judgeAfterDays: JUDGE_AFTER_DAYS,
    facts: {
      designs: rows.length, sales: totalSales, judged: judged.length,
      // of designs on Etsy long enough to judge, the share that sold nothing in 12 months
      zeroPct: judged.length ? Math.round((judged.filter((r) => !r.sales).length / judged.length) * 100) : 0,
      top75Share: totalSales ? Math.round((topRows.reduce((s, r) => s + r.sales, 0) / totalSales) * 100) : 0,
      avgPerDesign: r2(avg), newLast30: recent.length,
      trayMultiple: tray?.judged && wall ? r1(tray.perMonth / wall) : null,
    },
    collections, subjects, formats, brief, followed,
    top: topRows.map((r, i) => ({ rank: i + 1, title: r.title, slug: r.slug, sales: r.sales, views: r.views, fav: r.fav, price: r.price, collection: r.cats[0] || '', image: r.image })),
  };
}
