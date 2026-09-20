import { supabase } from './supabase';

export type ProductCard = {
  id: string; title: string; slug: string; price_usd: number;
  image_url: string | null; is_bundle: boolean; link_status: string;
  rating_avg?: number | null; rating_count?: number | null;
  customer_photo_url?: string | null;   // a real buyer's carve, from an approved photo review
};

const CARD = 'id,title,slug,price_usd,image_url,is_bundle,link_status,rating_avg,rating_count,customer_photo_url';

export type SiteSettings = {
  donation_total: number; rating: number; reviews_count: number;
  sales_count: number; products_count: number; admirers_count: number; experience_years: number;
  discount_percent: number; hero_image_url: string | null; hero_headline: string;
  hero_subhead: string; featured_product_id: string | null; admin_email: string;
  banner_image_url: string | null;
  logo_image_url: string | null; favicon_image_url: string | null;
  membership_image_url: string | null; membership_title: string; membership_subtitle: string;
  free_image_url: string | null; welfare_image_url: string | null; welfare_text: string;
  trust_badges: { icon: string; label: string }[];
  announcement_active: boolean; announcement_text: string | null;
  announcement_link: string | null; announcement_cta_label: string | null;
  announcement_font_size: number | null; announcement_speed_seconds: number | null;
  order_sound_enabled: boolean; order_sound_volume: number | null;
  marquee_settings: Record<string, { enabled: boolean; speed: number; direction: 'left' | 'right' }>;
};

export const MARQUEE_DEFAULTS: SiteSettings['marquee_settings'] = {
  collections: { enabled: true, speed: 45, direction: 'left' },
  bestsellers: { enabled: true, speed: 50, direction: 'left' },
  premium: { enabled: true, speed: 90, direction: 'left' },
  madeforyou: { enabled: false, speed: 60, direction: 'left' },
  creations: { enabled: true, speed: 55, direction: 'left' },
  reviews: { enabled: true, speed: 60, direction: 'left' },
};

const SETTINGS_FALLBACK: SiteSettings = {
  donation_total: 7670, rating: 4.9, reviews_count: 577,
  sales_count: 4543, products_count: 1235, admirers_count: 505, experience_years: 20,
  discount_percent: 20, hero_image_url: null,
  hero_headline: 'Art that carves with purpose',
  hero_subhead: 'Hundreds of museum-grade bas-relief designs, instantly downloadable. CNC-ready, commercial-use included.',
  featured_product_id: null, admin_email: 'jolly@digitalchiselco.com',
  banner_image_url: null,
  logo_image_url: null, favicon_image_url: null,
  membership_image_url: null,
  // {price} {per_month} {months} {files} {total_files} {retail} {pct_off} are
  // filled from the featured plan at render time (src/lib/membership-facts.ts),
  // so the homepage never quotes a stale membership price.
  membership_title: 'Become a Member — {per_month}/month',
  membership_subtitle: 'Get {files} fresh bas-relief STL designs every month — {total_files} carving files for {price}. Lock in your low price now.',
  free_image_url: null, welfare_image_url: null,
  welfare_text: "Half of every sale builds something bigger than a shop. We donate 50% of our profits to families in need and to animal welfare. Every time you download a file, you're helping us make that happen.",
  trust_badges: [
    { icon: '⬇', label: 'Instant Download' },
    { icon: '👍', label: '99% Positive Feedback' },
    { icon: '♾', label: 'Unlimited Time Download' },
    { icon: '🔒', label: '100% Payment Security' },
    { icon: '💬', label: 'Contact Us for Help' },
  ],
  marquee_settings: MARQUEE_DEFAULTS,
};

export async function getSettings(): Promise<SiteSettings> {
  try {
    const { data, error } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return { ...SETTINGS_FALLBACK, ...(data ?? {}) } as SiteSettings;
  } catch (e) { console.error('getSettings failed:', e); return SETTINGS_FALLBACK; }
}

// How many designs the shop sells, as a round "1,900+" label. Hard-coded
// numbers on the product pages went stale (they still said 1,200+ at 1,971
// designs, owner 2026-09-20), so the pages ask for this instead. Rounds DOWN
// to the nearest hundred, so the claim is always true, and it turns into
// "2,000+" on its own the day the catalogue gets there.
let designCount: { at: number; label: string } = { at: 0, label: '1,900+' };
export async function designCountLabel(): Promise<string> {
  if (Date.now() - designCount.at < 3600000) return designCount.label;
  try {
    const { supabaseAdmin } = await import('./supabase');
    // Bundles and membership plans are products in the table but not designs.
    const { count } = await supabaseAdmin().from('products')
      .select('id', { count: 'exact', head: true }).eq('active', true).eq('is_bundle', false).is('membership_plan_slug', null);
    if (count && count >= 100) {
      designCount = { at: Date.now(), label: (Math.floor(count / 100) * 100).toLocaleString('en-US') + '+' };
    }
  } catch { /* keep the last good label */ }
  return designCount.label;
}

// Is Cut Local live? Header and Footer both need this on every page, so the
// answer is held for a minute rather than queried twice per render.
let mpLive: { at: number; on: boolean } = { at: 0, on: false };
export async function marketplaceLive(): Promise<boolean> {
  if (Date.now() - mpLive.at < 60000) return mpLive.on;
  try {
    const { supabaseAdmin } = await import('./supabase');
    const { data } = await supabaseAdmin().from('growth_settings').select('marketplace_enabled').eq('id', 1).maybeSingle();
    mpLive = { at: Date.now(), on: !!data?.marketplace_enabled };
  } catch { mpLive = { at: Date.now(), on: mpLive.on }; }
  return mpLive.on;
}

/**
 * Customer-facing product search. Splits the query into tokens (so
 * "wolf moon" matches even when the title has them in different orders),
 * matches each token against title + description, and ranks results so
 * title hits float above description-only hits.
 */
export async function searchProducts(q: string, limit = 60) {
  const term = q.trim();
  if (!term) return [];
  // Sanitise tokens — PostgREST's or() uses commas + parens as syntax.
  const tokens = term.split(/\s+/).map((t) => t.replace(/[,()*]/g, '')).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  try {
    // Build (title.ilike.*tok* OR description.ilike.*tok*) per token, ANDed.
    let qb: any = supabase.from('products').select(CARD).eq('active', true);
    for (const t of tokens) {
      qb = qb.or(`title.ilike.*${t}*,description.ilike.*${t}*`);
    }
    qb = qb.limit(Math.min(200, limit * 3));
    const { data, error } = await qb;
    if (error) throw error;
    const rows = (data ?? []) as ProductCard[] & { title: string }[];
    // Rank: title hit count first, then position-in-title earliness.
    const lower = tokens.map((t) => t.toLowerCase());
    const scored = rows.map((p: any) => {
      const tl = (p.title || '').toLowerCase();
      let titleHits = 0; let firstPos = 9999;
      for (const t of lower) {
        const pos = tl.indexOf(t);
        if (pos >= 0) { titleHits++; if (pos < firstPos) firstPos = pos; }
      }
      return { p, titleHits, firstPos };
    });
    scored.sort((a, b) => (b.titleHits - a.titleHits) || (a.firstPos - b.firstPos));
    const strict = scored.slice(0, limit).map((s) => s.p) as ProductCard[];
    if (strict.length) return strict;

    // ── Synonym fallback ─────────────────────────────────────────────
    // Strict AND-of-tokens found nothing. Re-search with each token expanded
    // to its synonym group ("cowboy hat" → western/rodeo/ranch; "xmas" →
    // christmas; "kitty" → cat), OR-ing the alternatives, so shopper
    // vocabulary that differs from catalog vocabulary still finds designs.
    const { expand } = await import('./search-smart');
    const alts = expand(term).map((t) => t.replace(/[,()*]/g, '')).filter((t) => t.length >= 2 && !tokens.includes(t)).slice(0, 12);
    if (!alts.length) return [];
    let qb2: any = supabase.from('products').select(CARD).eq('active', true);
    qb2 = qb2.or(alts.map((t) => `title.ilike.*${t}*`).join(',')).limit(limit);
    const { data: d2 } = await qb2;
    return (d2 ?? []) as ProductCard[];
  } catch (e) { console.error('searchProducts failed:', e); return []; }
}

/** Distinct words across active product titles with frequency — the vocabulary
 *  the fuzzy "did you mean" suggests from. Cached in-process for 10 minutes. */
let _vocab: { at: number; map: Map<string, number> } | null = null;
export async function titleVocabulary(): Promise<Map<string, number>> {
  if (_vocab && Date.now() - _vocab.at < 10 * 60000) return _vocab.map;
  const map = new Map<string, number>();
  try {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('products').select('title').eq('active', true).range(from, from + 999);
      for (const p of data || []) {
        for (const w of String((p as any).title || '').split('|')[0].toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
          if (w.length >= 3) map.set(w, (map.get(w) || 0) + 1);
        }
      }
      if (!data || data.length < 1000) break;
    }
  } catch { /* empty vocab → no suggestions */ }
  _vocab = { at: Date.now(), map };
  return map;
}

// ── Seasonal collections (Admin > Seasonal) ──────────────────────────
// The landing page used to require each keyword PHRASE to appear verbatim
// inside a product title, and only looked at the first 12 keywords. The
// Halloween collection's keywords are search phrases ("3D Halloween STL",
// "Halloween wall art STL"); no title contains one of those as a single string,
// so the page matched nothing (owner, 2026-09-15). Matching now works the way
// a person would read those keywords: each phrase is broken into its subject
// words (generic carving words dropped), a product matches when its title or
// tags carry any subject word, and products filed in a category whose name
// shares a subject word are included too. Best sellers first.
const SEASON_STOP = new Set(['stl','cnc','3d','relief','reliefs','file','files','router','carving','carvings','wood','wooden','woodworking','printing','print','wall','art','decor','decoration','decorations','design','designs','model','models','digital','download','for','the','and','of','a','sign','signs','plaque','panel','gift','gifts','laser','bas']);
export function seasonSubjectWords(keywords: unknown): string[] {
  const out = new Set<string>();
  for (const k of (Array.isArray(keywords) ? keywords : [])) {
    for (const w of String(k).toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3 && !SEASON_STOP.has(w)) out.add(w);
    }
  }
  return [...out].slice(0, 40);
}
export async function getLiveSeasonalCollection() {
  try {
    const { supabaseAdmin } = await import('./supabase');
    const now = new Date().toISOString();
    const { data } = await supabaseAdmin().from('seasonal_collections').select('*').eq('active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
      .order('ends_at', { ascending: true, nullsFirst: false }).limit(1);
    return data?.[0] || null;
  } catch { return null; }
}
export async function getSeasonalProducts(col: { keywords?: unknown; title?: string; include_ids?: unknown; exclude_ids?: unknown }, limit = 60): Promise<ProductCard[]> {
  try {
    const { supabaseAdmin } = await import('./supabase');
    const db = supabaseAdmin();
    const words = seasonSubjectWords(col.keywords);
    // Hand-curation over the keyword matches: include_ids are always in and
    // come first, exclude_ids never appear however well a keyword matches.
    const includeIds = (Array.isArray(col.include_ids) ? col.include_ids : []).map(String);
    const excludeIds = new Set((Array.isArray(col.exclude_ids) ? col.exclude_ids : []).map(String));
    let pinned: any[] = [];
    if (includeIds.length) {
      const { data } = await db.from('products').select(CARD + ',etsy_sales_365,created_at').in('id', includeIds).eq('active', true);
      const order = new Map(includeIds.map((id, i) => [id, i]));
      pinned = (data || []).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    if (!words.length) return pinned.filter((p) => !excludeIds.has(p.id)).slice(0, limit) as ProductCard[];
    const safe = (w: string) => w.replace(/[,()*%]/g, '');
    // 1) titles carrying a subject word. (Tags are jsonb, and a substring
    //    match on a jsonb array is not expressible in a PostgREST or=; titles
    //    plus the category union below cover the set comfortably.)
    const orExpr = words.map((w) => `title.ilike.*${safe(w)}*`).join(',');
    const { data: byWord } = await db.from('products').select(CARD + ',etsy_sales_365,created_at')
      .eq('active', true).not('image_url', 'is', null).or(orExpr)
      .order('etsy_sales_365', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(limit);
    // 2) whole categories whose name shares a subject word (the curated set)
    const { data: cats } = await db.from('categories').select('id, name');
    const catIds = (cats || []).filter((c: any) => words.some((w) => String(c.name).toLowerCase().includes(w))).map((c: any) => c.id);
    let byCat: any[] = [];
    if (catIds.length) {
      const { data } = await db.from('products').select(`${CARD},etsy_sales_365,created_at, product_categories!inner(category_id)`)
        .eq('active', true).not('image_url', 'is', null).in('product_categories.category_id', catIds)
        .order('etsy_sales_365', { ascending: false, nullsFirst: false }).limit(limit);
      byCat = data || [];
    }
    const seen = new Set<string>(pinned.map((p) => p.id)); const merged: any[] = [];
    for (const p of [...(byWord || []), ...byCat]) { if (!seen.has(p.id) && !excludeIds.has(p.id)) { seen.add(p.id); merged.push(p); } }
    merged.sort((a, b) => (Number(b.etsy_sales_365) || 0) - (Number(a.etsy_sales_365) || 0) || String(b.created_at).localeCompare(String(a.created_at)));
    return [...pinned.filter((p) => !excludeIds.has(p.id)), ...merged].slice(0, limit) as ProductCard[];
  } catch (e) { console.error('getSeasonalProducts failed:', e); return []; }
}

// "Related" used to be five random products with no relation at all. Now it
// is the same collection's best sellers, which is the second sale a buyer of
// this design is most likely to make; falls back to shop-wide best sellers.
/** Designs real buyers put in the same order as this one (product_pairs,
 *  built from Etsy receipts + website orders). Most-often-together first. */
export async function getBoughtTogether(productId: string, limit = 2): Promise<(ProductCard & { together: number })[]> {
  try {
    const { data, error } = await supabase
      .from('product_pairs')
      .select(`together, pair:products!product_pairs_pair_id_fkey(${CARD}, active)`)
      .eq('product_id', productId)
      .order('together', { ascending: false })
      .limit(limit * 3);
    if (error) throw error;
    return (data || [])
      .filter((r: any) => r.pair && r.pair.active && r.pair.image_url && !r.pair.is_bundle && Number(r.pair.price_usd) > 0)
      .slice(0, limit)
      .map((r: any) => ({ ...r.pair, together: r.together }));
  } catch (e) { console.error('getBoughtTogether failed:', e); return []; }
}

export async function getRelatedProducts(excludeId: string, limit = 5, categoryId?: string | null) {
  try {
    if (categoryId) {
      const { data, error } = await supabase
        .from('products').select(`${CARD}, product_categories!inner(category_id)`)
        .eq('active', true).neq('id', excludeId).eq('product_categories.category_id', categoryId)
        .not('image_url', 'is', null)
        .order('etsy_sales_365', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      if (data && data.length >= Math.min(3, limit)) return data as ProductCard[];
    }
    const { data, error } = await supabase
      .from('products').select(CARD).eq('active', true).neq('id', excludeId)
      .not('image_url', 'is', null)
      .order('etsy_sales_365', { ascending: false, nullsFirst: false }).limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getRelatedProducts failed:', e); return []; }
}

// Lifetime units sold for a product (social proof on the product page).
// order_items has no anon RLS policy, so the anon client always saw 0 and the
// "N makers already own this" line never rendered. This runs at SSR time, so
// use the service-role client (lazy import keeps this module browser-safe).
export async function getSoldCount(productId: string): Promise<number> {
  try {
    const { supabaseAdmin } = await import('./supabase');
    const { count } = await supabaseAdmin().from('order_items').select('id', { count: 'exact', head: true }).eq('product_id', productId);
    return count || 0;
  } catch { return 0; }
}

export async function getCategories() {
  try {
    const { data, error } = await supabase.from('categories').select('*').order('sort_order');
    if (error) throw error;
    return data ?? [];
  } catch (e) { console.error('getCategories failed:', e); return []; }
}

export async function getCategoryBySlug(slug: string) {
  try {
    const { data, error } = await supabase.from('categories').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) { console.error('getCategoryBySlug failed:', e); return null; }
}

// `sort`: 'newest' puts the latest upload first; the default stays A to Z.
// Alphabetical was the ONLY order the catalog had, so a bundle uploaded this
// morning landed on page 15 behind everything that happened to start with an
// earlier letter, and nobody, owner included, could find it (2026-09-15).
// 'best' (the default everywhere since 2026-09-15) puts the designs that
// actually sell first, from the Etsy sales data; unsold designs follow newest
// first, so a fresh upload is never buried behind a dead one.
export type CatalogSort = 'best' | 'title' | 'newest';
export const sortOf = (v: string | null | undefined): CatalogSort => (v === 'newest' || v === 'title' ? v : 'best');
function applySort<T extends { order: (...a: any[]) => T }>(q: T, sort: CatalogSort): T {
  if (sort === 'newest') return q.order('created_at', { ascending: false }).order('title');
  if (sort === 'title') return q.order('title');
  return q.order('etsy_sales_365', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
}
export async function getProducts(page = 1, perPage = 48, sort: CatalogSort = 'best') {
  const from = (page - 1) * perPage;
  try {
    const q = applySort(supabase.from('products').select(CARD, { count: 'exact' }).eq('active', true) as any, sort);
    const { data, count, error } = await q.range(from, from + perPage - 1);
    if (error) throw error;
    return { products: (data ?? []) as ProductCard[], total: count ?? 0, page, perPage };
  } catch (e) { console.error('getProducts failed:', e); return { products: [], total: 0, page, perPage }; }
}

export async function getProductsByCategory(categoryId: string, page = 1, perPage = 48, sort: CatalogSort = 'best') {
  const from = (page - 1) * perPage;
  try {
    const q = applySort(supabase
      .from('products').select(`${CARD}, product_categories!inner(category_id)`, { count: 'exact' })
      .eq('active', true).eq('product_categories.category_id', categoryId) as any, sort);
    const { data, count, error } = await q.range(from, from + perPage - 1);
    if (error) throw error;
    return { products: (data ?? []) as ProductCard[], total: count ?? 0, page, perPage };
  } catch (e) { console.error('getProductsByCategory failed:', e); return { products: [], total: 0, page, perPage }; }
}

export async function getProductBySlug(slug: string) {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_categories(categories(name, slug))')
      .eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) { console.error('getProductBySlug failed:', e); return null; }
}

export async function getProductById(id: string) {
  try {
    const { data, error } = await supabase
      .from('products').select('id,image_url').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) { console.error('getProductById failed:', e); return null; }
}

// Given a set of product IDs the user currently has in cart, return products
// from the same categories (excluding those already in the cart).
// Best sellers come from the sales data, not from a hand-set flag. The flag
// was sorted A to Z, so "Best Sellers" showed whatever the admin had ticked,
// alphabetically, while the 20-a-year designs sat unflagged (owner,
// 2026-09-15: "we have Etsy data, I want the best sellers always at top").
// The flag still counts as a tie-break, so a hand pick can nudge, not override.
export async function getBestSellers(limit = 8): Promise<ProductCard[]> {
  try {
    const { data, error } = await supabase
      .from('products').select(CARD).eq('active', true)
      .not('image_url', 'is', null).eq('is_bundle', false)
      .order('etsy_sales_365', { ascending: false, nullsFirst: false })
      .order('is_bestseller', { ascending: false })
      .order('rating_count', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getBestSellers failed:', e); return []; }
}

// "Just added" means exactly that: the newest live designs, always. The
// admin's is_latest_pick flag used to win and was sorted by title, so a
// design uploaded this morning never appeared there (owner, 2026-09-15).
export async function getLatestProducts(limit = 8): Promise<ProductCard[]> {
  try {
    const { data, error } = await supabase
      .from('products').select(CARD).eq('active', true)
      .not('image_url', 'is', null).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getLatestProducts failed:', e); return []; }
}

export async function getCustomizableProducts(limit = 12): Promise<ProductCard[]> {
  try {
    const { data, error } = await supabase
      .from('products').select(CARD).eq('active', true).eq('is_customizable', true)
      .not('image_url', 'is', null).order('title').limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getCustomizableProducts failed:', e); return []; }
}

export type Review = { id: string; name: string; text: string; rating: number; source: string | null; sort_order: number };
export async function getReviews(limit = 12): Promise<Review[]> {
  try {
    // status='approved' is essential: website submissions land as 'pending'
    // with active=true and sort_order 0, so without this filter an unmoderated
    // review appeared on the homepage instantly (moderation bypass).
    const { data, error } = await supabase
      .from('reviews').select('id,name,text,rating,source,sort_order').eq('active', true).eq('status', 'approved')
      .order('sort_order').order('created_at').limit(limit);
    if (error) throw error;
    return (data ?? []) as Review[];
  } catch (e) { console.error('getReviews failed:', e); return []; }
}

export type Faq = { id: string; question: string; answer: string; sort_order: number };
export async function getFaqs(limit = 20): Promise<Faq[]> {
  try {
    const { data, error } = await supabase
      .from('faqs').select('id,question,answer,sort_order').eq('active', true)
      .order('sort_order').order('created_at').limit(limit);
    if (error) throw error;
    return (data ?? []) as Faq[];
  } catch (e) { console.error('getFaqs failed:', e); return []; }
}

export type MembershipPlan = {
  id: string; slug: string; name: string; months: number; files_per_month: number;
  price_usd: number; original_price_usd: number | null; features: string[];
  highlight: boolean; sort_order: number;
};
// A plan with available_from in the future stays off the public picker until
// that day (the 12-month Premium launches 2027-01-01). `preview` shows it
// anyway, for testing the purchase path before launch.
export async function getMembershipPlans(opts: { preview?: boolean } = {}): Promise<MembershipPlan[]> {
  try {
    const { data, error } = await supabase
      .from('membership_plans')
      .select('id,slug,name,months,files_per_month,price_usd,original_price_usd,features,highlight,sort_order,available_from')
      .eq('active', true).order('sort_order');
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    return (data ?? [])
      .filter((p: any) => opts.preview || !p.available_from || String(p.available_from) <= today)
      .map((p: any) => ({ ...p, features: Array.isArray(p.features) ? p.features : [] })) as MembershipPlan[];
  } catch (e) { console.error('getMembershipPlans failed:', e); return []; }
}

export async function getRelatedToProducts(productIds: string[], limit = 8): Promise<ProductCard[]> {
  if (!productIds.length) return [];
  try {
    // 1) find category ids for those products
    const { data: pcs } = await supabase
      .from('product_categories').select('category_id').in('product_id', productIds);
    const catIds = Array.from(new Set((pcs ?? []).map((r) => r.category_id)));
    if (!catIds.length) return [];
    // 2) find product ids in any of those categories (excluding cart items)
    const { data: pool } = await supabase
      .from('product_categories').select('product_id').in('category_id', catIds);
    const candidateIds = Array.from(new Set((pool ?? []).map((r) => r.product_id))).filter((id) => !productIds.includes(id));
    if (!candidateIds.length) return [];
    // shuffle a bit so each visit varies, then take top N
    const sample = candidateIds.sort(() => Math.random() - 0.5).slice(0, limit * 3);
    const { data, error } = await supabase
      .from('products').select(CARD).in('id', sample).eq('active', true)
      .not('image_url', 'is', null).limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getRelatedToProducts failed:', e); return []; }
}

export type CustomerCreation = {
  id: string; name: string; description: string | null; gallery: string[];
  product_id: string | null; product_url: string | null; is_featured: boolean;
  products?: { title: string; slug: string } | null;
};
// Fetch active bundle products grouped under the "PREMIUM BUNDLE OFFER" category
// (created in scripts/seed_premium_bundles.mjs). Skips inactive/memberships.
export async function getPremiumBundles(limit = 12): Promise<ProductCard[]> {
  try {
    // First find the category id by slug (one query, cached by Supabase pooler).
    const { data: cat } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', 'premium-bundle-offer')
      .maybeSingle();
    if (!cat?.id) return [];
    const { data, error } = await supabase
      .from('products')
      .select(`${CARD}, product_categories!inner(category_id)`)
      .eq('active', true)
      .eq('product_categories.category_id', cat.id)
      .eq('is_bundle', true)
      .neq('is_subscription', true)
      .order('price_usd', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getPremiumBundles failed:', e); return []; }
}

export async function getCustomerCreations(limit = 9): Promise<CustomerCreation[]> {
  try {
    const { data, error } = await supabase
      .from('customer_creations')
      .select('id,name,description,gallery,product_id,product_url,is_featured,products(title,slug)')
      .eq('active', true)
      .order('is_featured', { ascending: false })
      .order('sort_order')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as any;
  } catch (e) { console.error('getCustomerCreations failed:', e); return []; }
}
