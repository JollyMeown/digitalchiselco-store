import { supabase } from './supabase';

export type ProductCard = {
  id: string; title: string; slug: string; price_usd: number;
  image_url: string | null; is_bundle: boolean; link_status: string;
};

export async function getCategories() {
  const { data } = await supabase.from('categories').select('*').order('sort_order');
  return data ?? [];
}

export async function getCategoryBySlug(slug: string) {
  const { data } = await supabase.from('categories').select('*').eq('slug', slug).maybeSingle();
  return data;
}

const CARD = 'id,title,slug,price_usd,image_url,is_bundle,link_status';

export async function getProducts(page = 1, perPage = 48) {
  const from = (page - 1) * perPage;
  const { data, count } = await supabase
    .from('products')
    .select(CARD, { count: 'exact' })
    .eq('active', true)
    .order('title')
    .range(from, from + perPage - 1);
  return { products: (data ?? []) as ProductCard[], total: count ?? 0, page, perPage };
}

export async function getProductsByCategory(categoryId: string, page = 1, perPage = 48) {
  const from = (page - 1) * perPage;
  const { data, count } = await supabase
    .from('products')
    .select(`${CARD}, product_categories!inner(category_id)`, { count: 'exact' })
    .eq('active', true)
    .eq('product_categories.category_id', categoryId)
    .order('title')
    .range(from, from + perPage - 1);
  return { products: (data ?? []) as ProductCard[], total: count ?? 0, page, perPage };
}

export async function getProductBySlug(slug: string) {
  const { data } = await supabase
    .from('products')
    .select('*, product_downloads(download_link, file_name), product_categories(categories(name, slug))')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}
