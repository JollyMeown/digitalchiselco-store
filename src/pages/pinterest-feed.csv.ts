// Pinterest product catalog feed. Served at /pinterest-feed.csv. Point a
// Pinterest Catalog data source at https://digitalchiselco.com/pinterest-feed.csv
// and Pinterest auto-creates a Product Pin for every active product and
// refreshes daily. Uses the SEO-optimized title + description when available.
//
// Columns follow Pinterest's catalog spec (a superset of Google Merchant):
// id, title, description, link, image_link, price, sale_price, availability,
// brand, condition, product_type, google_product_category.

import { supabase } from '../lib/supabase';
import { pricing } from '../lib/pricing';

export const prerender = false;

const SITE = process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
const GPC = 'Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts';

// CSV cell: collapse whitespace/newlines, then RFC-4180 quote.
function cell(v: unknown): string {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET() {
  const headers = ['id', 'title', 'description', 'link', 'image_link', 'price', 'sale_price', 'availability', 'brand', 'condition', 'product_type', 'google_product_category'];
  const rows: string[] = [headers.join(',')];

  // Site-wide discount for the price/sale_price split.
  let discount = 20;
  try {
    const { data } = await supabase.from('site_settings').select('discount_percent').eq('id', 1).maybeSingle();
    if (data?.discount_percent != null) discount = Number(data.discount_percent) || 20;
  } catch {}

  const FALLBACK = (t: string) =>
    `${t} is a high-detail 3D bas-relief STL for CNC routers, laser engravers and 3D printers. Instant download, commercial use included. Tested in Aspire, VCarve Pro, Carveco, ArtCAM and Fusion 360.`;

  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('products')
        .select('id, title, slug, price_usd, image_url, seo_description, description, product_categories(categories(name))')
        .eq('active', true)
        .not('image_url', 'is', null)
        .order('slug')
        .range(from, from + 999);
      if (error) { console.error('pinterest feed page failed:', error); break; }
      const batch = data || [];
      for (const p of batch as any[]) {
        const title = String(p.title || '').split('|')[0].trim().slice(0, 100);
        const desc = (p.seo_description || (p.description || '').slice(0, 480) || FALLBACK(title)).slice(0, 500);
        const { price, original, percent } = pricing(p.price_usd, discount);
        const cats = (p.product_categories || []).map((pc: any) => pc.categories?.name).filter(Boolean).join(' > ');
        rows.push([
          cell(p.id),
          cell(title),
          cell(desc),
          cell(`${SITE}/product/${p.slug}`),
          cell(p.image_url),
          cell(`${original.toFixed(2)} USD`),
          cell(percent > 0 ? `${price.toFixed(2)} USD` : ''),
          cell('in stock'),
          cell('DigitalChiselCo'),
          cell('new'),
          cell(cats || 'Bas-Relief STL Files'),
          cell(GPC),
        ].join(','));
      }
      if (batch.length < 1000) break;
    }
  } catch (e) { console.error('pinterest feed failed:', e); }

  return new Response(rows.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'content-disposition': 'inline; filename="pinterest-feed.csv"',
    },
  });
}
