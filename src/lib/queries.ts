import { supabase } from './supabase';

export type ProductCard = {
  id: string; title: string; slug: string; price_usd: number;
  image_url: string | null; is_bundle: boolean; link_status: string;
};

const CARD = 'id,title,slug,price_usd,image_url,is_bundle,link_status';

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
  membership_title: 'Become a Member — $6.70/month',
  membership_subtitle: 'Get 8 fresh bas-relief STL designs every month — 24 carving files for $20. Lock in your low price now.',
  free_image_url: null, welfare_image_url: null,
  welfare_text: "Half of every sale builds something bigger than a shop. We donate 50% of our profits to families in need and to animal welfare. Every time you download a file, you're helping us make that happen.",
  trust_badges: [
    { icon: '⬇', label: 'Instant Download' },
    { icon: '👍', label: '99% Positive Feedback' },
    { icon: '♾', label: 'Unlimited Time Download' },
    { icon: '🔒', label: '100% Payment Security' },
    { icon: '💬', label: 'Contact Us for Help' },
  ],
};

export async function getSettings(): Promise<SiteSettings> {
  try {
    const { data, error } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return { ...SETTINGS_FALLBACK, ...(data ?? {}) } as SiteSettings;
  } catch (e) { console.error('getSettings failed:', e); return SETTINGS_FALLBACK; }
}

export async function searchProducts(q: string, limit = 60) {
  const term = q.trim();
  if (!term) return [];
  try {
    const { data, error } = await supabase
      .from('products').select(CARD).eq('active', true)
      .ilike('title', `%${term}%`).order('title').limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('searchProducts failed:', e); return []; }
}

export async function getRelatedProducts(excludeId: string, limit = 5) {
  try {
    const { data, error } = await supabase
      .from('products').select(CARD).eq('active', true).neq('id', excludeId)
      .not('image_url', 'is', null).limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getRelatedProducts failed:', e); return []; }
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

export async function getProducts(page = 1, perPage = 48) {
  const from = (page - 1) * perPage;
  try {
    const { data, count, error } = await supabase
      .from('products').select(CARD, { count: 'exact' })
      .eq('active', true).order('title').range(from, from + perPage - 1);
    if (error) throw error;
    return { products: (data ?? []) as ProductCard[], total: count ?? 0, page, perPage };
  } catch (e) { console.error('getProducts failed:', e); return { products: [], total: 0, page, perPage }; }
}

export async function getProductsByCategory(categoryId: string, page = 1, perPage = 48) {
  const from = (page - 1) * perPage;
  try {
    const { data, count, error } = await supabase
      .from('products').select(`${CARD}, product_categories!inner(category_id)`, { count: 'exact' })
      .eq('active', true).eq('product_categories.category_id', categoryId)
      .order('title').range(from, from + perPage - 1);
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
export async function getBestSellers(limit = 8): Promise<ProductCard[]> {
  try {
    const { data, error } = await supabase
      .from('products').select(CARD).eq('active', true).eq('is_bestseller', true)
      .not('image_url', 'is', null).order('title').limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getBestSellers failed:', e); return []; }
}

export async function getLatestProducts(limit = 8): Promise<ProductCard[]> {
  try {
    const { data, error } = await supabase
      .from('products').select(CARD).eq('active', true)
      .not('image_url', 'is', null).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []) as ProductCard[];
  } catch (e) { console.error('getLatestProducts failed:', e); return []; }
}

export type Review = { id: string; name: string; text: string; rating: number; source: string | null; sort_order: number };
export async function getReviews(limit = 12): Promise<Review[]> {
  try {
    const { data, error } = await supabase
      .from('reviews').select('id,name,text,rating,source,sort_order').eq('active', true)
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
export async function getMembershipPlans(): Promise<MembershipPlan[]> {
  try {
    const { data, error } = await supabase
      .from('membership_plans')
      .select('id,slug,name,months,files_per_month,price_usd,original_price_usd,features,highlight,sort_order')
      .eq('active', true).order('sort_order');
    if (error) throw error;
    return (data ?? []).map((p: any) => ({ ...p, features: Array.isArray(p.features) ? p.features : [] })) as MembershipPlan[];
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
