import type { APIRoute } from 'astro';
import { getRelatedToProducts, getProducts } from '../../lib/queries';

export const prerender = false;

// POST { ids: string[] } -> { products: ProductCard[] }
// Returns products in the same categories as the cart items.
// Empty/missing ids → returns a small generic fallback so the cart can still
// render a "you may also like" strip on an empty cart.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string') : [];
    let products: any[] = [];
    if (ids.length) products = await getRelatedToProducts(ids, 8);
    if (!products.length) {
      const { products: fallback } = await getProducts(1, 8);
      products = fallback.filter((p: any) => p.image_url).slice(0, 8);
    }
    return new Response(JSON.stringify({ products }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error('related failed:', e);
    return new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
};
