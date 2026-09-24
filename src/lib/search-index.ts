// Faceted product search ("Search your model").
//
// The whole active catalog (about 2,000 designs) is small enough to hold in
// memory, so it is loaded once per server instance, cached for five minutes,
// and every search, filter and facet count after that is computed in-process.
// That is what lets the filters answer instantly and show honest counts
// ("Deer: Hunting Lodge 41, Wildlife 37...") instead of one database round
// trip per checkbox.
//
// Matching, per query word, in this order of strength:
//   1. the word in the title
//   2. a synonym or translation of it in the title (search-smart GROUPS:
//      "kitty" -> cat, "droga krzyzowa" -> stations of the cross)
//   3. the word or a synonym in the tags / collection names
// Every query word must match somehow (AND). If that finds nothing, any word
// may match (OR). If that finds nothing, the typo fixer suggests a spelling.
// Brand names we cannot sell (Ford, Mickey...) map to a generic subject with a
// note, so the shopper still sees something relevant.
import { supabase } from './supabase';
import { expand, tokens, didYouMean, normalise, canonical } from './search-smart';
import type { ProductCard } from './queries';

export type Shape = 'square' | 'portrait' | 'landscape';
export type Kind = 'single' | 'bundle' | 'software';
export type Entry = ProductCard & {
  cats: string[];            // category slugs
  title_n: string;           // normalised title (first | segment)
  tags_n: string;            // normalised seo_keywords + collection names
  sales: number;
  created: number;
  shape: Shape | null;
  kind: Kind;
};

export const PRICE_BUCKETS = [
  { key: 'u8', label: 'Under $8', min: 0, max: 8 },
  { key: '8-12', label: '$8 to $12', min: 8, max: 12 },
  { key: '12-20', label: '$12 to $20', min: 12, max: 20 },
  { key: '20p', label: '$20 and up', min: 20, max: Infinity },
] as const;

export const SORTS = [
  { key: 'relevance', label: 'Best match' },
  { key: 'best', label: 'Best sellers' },
  { key: 'newest', label: 'Newest' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
] as const;
export type SortKey = typeof SORTS[number]['key'];

// Brands we do not sell (licensed logos, trademarks). Mapped to a subject we
// do carry, so "ford" shows trucks with an honest note instead of nothing.
const BRANDS: Record<string, string> = {
  ford: 'truck', chevy: 'truck', chevrolet: 'truck', dodge: 'truck', gmc: 'truck',
  kenworth: 'truck', peterbilt: 'truck', w900: 'truck', mack: 'truck', freightliner: 'truck',
  jeep: 'truck', mickey: 'mouse', minnie: 'mouse', disney: 'cartoon',
  packers: 'football', steelers: 'football', yankees: 'baseball', marvel: 'superhero', batman: 'superhero',
};

type Cat = { id: string; slug: string; name: string };
let cache: { at: number; entries: Entry[]; cats: Cat[] } | null = null;
let loading: Promise<{ entries: Entry[]; cats: Cat[] }> | null = null;

const SEL = 'id,title,slug,price_usd,image_url,is_bundle,link_status,rating_avg,rating_count,customer_photo_url,etsy_sales_365,created_at,seo_keywords,membership_plan_slug,model_specs->width,model_specs->height,product_categories(category_id)';

async function load(): Promise<{ entries: Entry[]; cats: Cat[] }> {
  const [{ data: catRows }, { count }] = await Promise.all([
    supabase.from('categories').select('id,slug,name').order('sort_order'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('active', true),
  ]);
  const cats = ((catRows || []) as Cat[]).filter((c) => !/subscription/i.test(c.name));
  const byId = new Map(cats.map((c) => [c.id, c]));
  // pages in parallel: one round trip instead of three
  const pages = Math.max(1, Math.ceil((count || 0) / 1000));
  const results = await Promise.all(Array.from({ length: pages }, (_, i) =>
    supabase.from('products').select(SEL).eq('active', true).order('id').range(i * 1000, i * 1000 + 999)));
  const entries: Entry[] = [];
  for (const r of results) {
    if (r.error) throw r.error;
    for (const p of (r.data || []) as any[]) {
      if (p.membership_plan_slug) continue;              // memberships live on /membership
      const catList = (p.product_categories || []).map((x: any) => byId.get(x.category_id)).filter(Boolean) as Cat[];
      const w = Number(p.width), h = Number(p.height);
      const a = w > 0 && h > 0 ? w / h : 0;
      const kw = Array.isArray(p.seo_keywords) ? p.seo_keywords.join(' ') : String(p.seo_keywords || '');
      entries.push({
        id: p.id, title: p.title, slug: p.slug, price_usd: Number(p.price_usd), image_url: p.image_url,
        is_bundle: !!p.is_bundle, link_status: p.link_status, rating_avg: p.rating_avg, rating_count: p.rating_count,
        customer_photo_url: p.customer_photo_url,
        cats: catList.map((c) => c.slug),
        title_n: ' ' + normalise(String(p.title || '').split('|')[0]) + ' ',
        tags_n: ' ' + normalise(kw + ' ' + catList.map((c) => c.name).join(' ')) + ' ',
        sales: Number(p.etsy_sales_365) || 0,
        created: Date.parse(p.created_at) || 0,
        shape: !a ? null : a > 1.12 ? 'landscape' : a < 0.89 ? 'portrait' : 'square',
        kind: String(p.slug).startsWith('software-') ? 'software' : p.is_bundle ? 'bundle' : 'single',
      });
    }
  }
  return { entries, cats };
}

export async function catalogIndex() {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  // one load at a time: concurrent first requests share it
  loading ??= load().finally(() => { loading = null; });
  try {
    const { entries, cats } = await loading;
    cache = { at: Date.now(), entries, cats };
  } catch (e) {
    console.error('catalogIndex load failed:', e);
    if (!cache) throw e;                 // stale beats nothing
  }
  return cache!;
}

// Singular and plural forms of one word, so "trays" finds "Serving Tray" and
// "pony" finds "Ponies". Phrases are matched as they are.
function forms(t: string): string[] {
  if (t.includes(' ')) return [t];
  const f = [t];
  if (t.endsWith('ies') && t.length > 4) f.push(t.slice(0, -3) + 'y');
  else if (t.endsWith('es') && t.length > 4) f.push(t.slice(0, -2), t.slice(0, -1));
  else if (t.endsWith('s') && t.length > 3 && !t.endsWith('ss')) f.push(t.slice(0, -1));
  else { f.push(t + 's'); if (/(s|x|ch|sh)$/.test(t)) f.push(t + 'es'); if (/[^aeiou]y$/.test(t)) f.push(t.slice(0, -1) + 'ies'); }
  return f;
}
// whole-word test on a space-padded normalised string ("cat" must not hit
// "catch", "christ" must not hit "christmas")
const hasAny = (hay: string, fs: string[]) => fs.some((f) => hay.includes(' ' + f + ' '));
const has = (hay: string, term: string) => hasAny(hay, forms(term));

export type Params = {
  q: string; cats: string[]; price: string[]; shape: Shape[]; kind: Kind | ''; best: boolean; fresh: boolean;
  sort: SortKey; page: number;
};
export function parseParams(u: URLSearchParams): Params {
  const list = (k: string) => u.getAll(k).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  const sortRaw = u.get('sort') || '';
  const q = (u.get('q') || '').trim().slice(0, 80);
  return {
    q,
    cats: list('cat'),
    price: list('price').filter((k) => PRICE_BUCKETS.some((b) => b.key === k)),
    shape: list('shape').filter((s): s is Shape => ['square', 'portrait', 'landscape'].includes(s)),
    kind: (['single', 'bundle', 'software'].includes(u.get('type') || '') ? u.get('type') : '') as Kind | '',
    best: u.get('best') === '1',
    fresh: u.get('new') === '1',
    sort: (SORTS.some((s) => s.key === sortRaw) ? sortRaw : q ? 'relevance' : 'best') as SortKey,
    page: Math.max(1, Math.min(50, parseInt(u.get('page') || '1', 10) || 1)),
  };
}
export function toQuery(p: Partial<Params>): string {
  const u = new URLSearchParams();
  if (p.q) u.set('q', p.q);
  for (const c of p.cats || []) u.append('cat', c);
  for (const c of p.price || []) u.append('price', c);
  for (const c of p.shape || []) u.append('shape', c);
  if (p.kind) u.set('type', p.kind);
  if (p.best) u.set('best', '1');
  if (p.fresh) u.set('new', '1');
  if (p.sort && p.sort !== (p.q ? 'relevance' : 'best')) u.set('sort', p.sort);
  if (p.page && p.page > 1) u.set('page', String(p.page));
  return u.toString();
}

export type Result = {
  params: Params;
  items: Entry[];            // this page
  total: number;
  shown: number;             // items rendered so far (page * per)
  facets: {
    cats: { slug: string; name: string; n: number }[];
    price: { key: string; label: string; n: number }[];
    shape: { key: Shape; n: number }[];
    kind: { key: Kind; n: number }[];
    best: number; fresh: number;
  };
  didYouMean: string | null;  // a spelling we searched instead
  partial: boolean;           // no design matched every word; showing any-word matches
  brand: string | null;       // a brand word we mapped to a generic subject
  matchedCats: { slug: string; name: string }[]; // collections whose name matches the query
};

export const PER_PAGE = 48;
const DAY = 86_400_000;

/** Score every entry for the query; entries that do not match are absent.
 *  Synonyms and translations only widen a word the catalog rarely uses in
 *  titles: "kitty" or "caballo" expand, "deer" and "tree" do not, so a common
 *  subject stays precise instead of pulling in every forest scene. */
function scoreAll(entries: Entry[], q: string, mode: 'all' | 'any'): Map<Entry, number> {
  const words = tokens(q);
  const out = new Map<Entry, number>();
  if (!words.length) { for (const e of entries) out.set(e, 0); return out; }
  const groups = words.map((w) => {
    const lit = forms(w);
    const common = entries.reduce((n, e) => n + (hasAny(e.title_n, lit) ? 1 : 0), 0) >= 8;
    const alts = common ? [] : expand(w).map(normalise).filter((t) => t && t !== w).map(forms);
    return { lit, alts };
  });
  const phrase = words.length > 1 ? ' ' + words.join(' ') + ' ' : '';
  for (const e of entries) {
    let score = 0, hit = 0;
    for (const { lit, alts } of groups) {
      let s = 0;
      if (hasAny(e.title_n, lit)) s = 10;
      else if (alts.some((a) => hasAny(e.title_n, a))) s = 6;
      else if (hasAny(e.tags_n, lit)) s = 4;
      else if (alts.some((a) => hasAny(e.tags_n, a))) s = 2;
      if (s) { hit++; score += s; }
    }
    if (mode === 'all' ? hit === groups.length : hit > 0) {
      // the whole phrase in the title beats scattered words
      if (phrase && e.title_n.includes(phrase)) score += 12;
      out.set(e, score + Math.min(3, Math.log10(1 + e.sales)));
    }
  }
  return out;
}

export async function search(params: Params): Promise<Result> {
  const { entries, cats } = await catalogIndex();
  let q = normalise(params.q);
  let brand: string | null = null;
  // brand words -> generic subject, remembered for the note
  if (q) {
    const ws = q.split(' ');
    const hit = ws.find((w) => BRANDS[w]);
    if (hit) { brand = hit; q = ws.map((w) => BRANDS[w] ?? w).filter((w, i, a) => a.indexOf(w) === i).join(' '); }
  }
  let scores = scoreAll(entries, q, 'all');
  // a translated phrase ("droga krzyzowa", "ultima cena") as the catalog says it
  if (q && scores.size === 0) { const c = canonical(q); if (c !== q) { const s2 = scoreAll(entries, c, 'all'); if (s2.size) { scores = s2; q = c; } } }
  let partial = false, dym: string | null = null;
  if (q && scores.size === 0) {
    const vocab = new Map<string, number>();
    for (const e of entries) for (const w of e.title_n.trim().split(' ')) if (w.length >= 3) vocab.set(w, (vocab.get(w) || 0) + 1);
    const fix = didYouMean(q, vocab);
    if (fix) { const s2 = scoreAll(entries, fix, 'all'); if (s2.size) { scores = s2; dym = fix; } }
  }
  if (q && scores.size === 0) { scores = scoreAll(entries, q, 'any'); partial = scores.size > 0; }

  const now = Date.now();
  const inPrice = (e: Entry, keys: string[]) => !keys.length || keys.some((k) => { const b = PRICE_BUCKETS.find((x) => x.key === k)!; return e.price_usd >= b.min && e.price_usd < b.max; });
  // each filter as a predicate, so facet counts can leave their own one out
  const F = {
    cats: (e: Entry) => !params.cats.length || e.cats.some((c) => params.cats.includes(c)),
    price: (e: Entry) => inPrice(e, params.price),
    shape: (e: Entry) => !params.shape.length || (!!e.shape && params.shape.includes(e.shape)),
    kind: (e: Entry) => !params.kind || e.kind === params.kind,
    best: (e: Entry) => !params.best || e.sales > 0,
    fresh: (e: Entry) => !params.fresh || now - e.created < 30 * DAY,
  };
  const keys = Object.keys(F) as (keyof typeof F)[];
  const base = [...scores.keys()];
  const passAll = (e: Entry, except?: keyof typeof F) => keys.every((k) => k === except || F[k](e));

  const matched = base.filter((e) => passAll(e));
  const cmp: Record<SortKey, (a: Entry, b: Entry) => number> = {
    relevance: (a, b) => (scores.get(b)! - scores.get(a)!) || (b.sales - a.sales) || (b.created - a.created),
    best: (a, b) => (b.sales - a.sales) || (b.created - a.created),
    newest: (a, b) => b.created - a.created,
    'price-asc': (a, b) => (a.price_usd - b.price_usd) || (b.sales - a.sales),
    'price-desc': (a, b) => (b.price_usd - a.price_usd) || (b.sales - a.sales),
  };
  const sort = params.sort === 'relevance' && !q ? 'best' : params.sort;
  matched.sort(cmp[sort]);

  const count = (except: keyof typeof F, pred: (e: Entry) => boolean) => base.reduce((n, e) => n + (passAll(e, except) && pred(e) ? 1 : 0), 0);
  const facets: Result['facets'] = {
    cats: cats.map((c) => ({ slug: c.slug, name: c.name, n: count('cats', (e) => e.cats.includes(c.slug)) }))
      .filter((c) => c.n > 0 || params.cats.includes(c.slug)).sort((a, b) => b.n - a.n),
    price: PRICE_BUCKETS.map((b) => ({ key: b.key, label: b.label, n: count('price', (e) => inPrice(e, [b.key])) })),
    shape: (['square', 'portrait', 'landscape'] as Shape[]).map((s) => ({ key: s, n: count('shape', (e) => e.shape === s) })),
    kind: (['single', 'bundle', 'software'] as Kind[]).map((k) => ({ key: k, n: count('kind', (e) => e.kind === k) })),
    best: count('best', (e) => e.sales > 0),
    fresh: count('fresh', (e) => now - e.created < 30 * DAY),
  };

  const words = tokens(q);
  const matchedCats = words.length
    ? cats.filter((c) => { const n = ' ' + normalise(c.name) + ' '; return words.some((w) => has(n, w)); }).slice(0, 3)
    : [];

  const shown = Math.min(matched.length, params.page * PER_PAGE);
  return {
    params, total: matched.length, shown,
    items: matched.slice((params.page - 1) * PER_PAGE, params.page * PER_PAGE),
    facets, didYouMean: dym, partial, brand, matchedCats: matchedCats.map((c) => ({ slug: c.slug, name: c.name })),
  };
}

/** The header dropdown: a few designs + matching collections + the total. */
export async function suggest(q: string, cat?: string) {
  const r = await search({ ...parseParams(new URLSearchParams()), q, cats: cat ? [cat] : [], sort: 'relevance' });
  return {
    items: r.items.slice(0, 6).map((e) => ({ id: e.id, slug: e.slug, title: String(e.title || '').split('|')[0].trim(), image_url: e.image_url, price: e.price_usd })),
    cats: r.matchedCats,
    total: r.total,
    via: r.didYouMean,
  };
}

/** What people actually search for most (site_events, Sep 2026), shown as
 *  one-tap chips when a search box is empty. */
export const POPULAR_SEARCHES = ['Deer', 'Jesus', 'Horse', 'Fish', 'Wolf', 'Tree of Life', 'Golden Retriever', 'Highland Cow', 'Serving Tray', 'Stations of the Cross', 'Eagle', 'Halloween'];

/** The filters and sort in force, without the words or page: what the search
 *  log stores as the path ("/search?cat=hunting-lodge-decor&price=u8"). */
export function filterPath(p: Params): string {
  // the default sort (best match with words, best sellers without) is not a choice
  const qs = toQuery({ ...p, q: '', page: 1, sort: p.sort === (p.q ? 'relevance' : 'best') ? undefined : p.sort });
  return '/search' + (qs ? '?' + qs : '');
}

/** Results that match the words as typed. A spelling fix, a brand swap or an
 *  any-word fallback counts as zero: that miss is the demand signal. */
export const literalCount = (r: Result) => (r.didYouMean || r.brand || r.partial ? 0 : r.total);
