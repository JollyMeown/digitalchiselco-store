import { supabase } from './supabase';

export type ProductCard = {
  id: string; title: string; slug: string; price_usd: number;
  image_url: string | null; is_bundle: boolean; link_status: string;
};

const CARD = 'id,title,slug,price_usd,image_url,is_bundle,link_status';

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
