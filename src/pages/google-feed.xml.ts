// Google Shopping product feed (RSS 2.0 + Google Merchant namespace).
// Served at /google-feed.xml. In Google Merchant Center -> Products -> Feeds,
// add a scheduled feed pointing at https://digitalchiselco.com/google-feed.xml
// and Google lists every active product in the FREE Shopping tab (and, if you
// ever run Shopping ads, the same feed powers those).
//
// Digital STL files are "new" physical-equivalent goods for Merchant purposes;
// we mark availability=in_stock and set the correct Arts & Crafts category.

import { supabase } from '../lib/supabase';
import { pricing } from '../lib/pricing';
import { img } from '../lib/img';

export const prerender = false;

const SITE = process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
const GPC = 'Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts';

// XML text escape (also strips control chars Google's parser rejects).
function xml(v: unknown): string {
  return String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\b\v\f\u000e-\u001f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Google rejects emoji outright: editing a product in Merchant Center shows
// "Input should not contain emoji characters" and "Customers won't see this
// product until you've fixed the errors". 336 of our 1,582 descriptions (21%)
// carry them, so a fifth of the catalogue was being held back by decoration.
// Stripped for GOOGLE ONLY — emoji stay on the website, Etsy and Pinterest,
// where they read well and are allowed.
function stripEmoji(s: string): string {
  return String(s || '')
    // pictographs, symbols, dingbats, arrows, variation selectors, ZWJ, skin tones
    .replace(/[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')      // tidy the gaps the emoji leave behind
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

// Shopping-optimised product title.
//
// Diagnosis behind this: 5,387 impressions produced 7 clicks (0.13%), and the
// single most-shown design took 387 impressions with ZERO clicks. Google's own
// guidance is that the title is the highest-weighted field in the feed, that
// only the first ~70 characters are visible, and that accuracy beats
// creativity. Two concrete faults in our titles:
//   1. "STL" alone does not read as a downloadable FILE to a shopper scanning
//      a grid of physical products, so the offer is ambiguous.
//   2. Nothing said "Digital Download", so people hunting for a physical
//      carving clicked away and people hunting for files did not recognise us.
// We fix both WITHOUT touching products.seo_title, because that drives the
// website's own SEO (organic clicks +400%) and must not be disturbed.
function shoppingTitle(raw: string): string {
  let t = String(raw || '').split('|')[0].trim();
  if (/\bstl\b/i.test(t)) {
    if (!/\bstl\s+files?\b/i.test(t)) {
      // "... STL Relief" reads badly as "... STL File Relief", so swap the
      // pair instead: "... Relief STL File".
      const swapped = t.replace(/\bstl\s+(relief|carving|model|design|panel|art|file)\b/i, (_m, w) => `${w[0].toUpperCase()}${w.slice(1)} STL File`);
      t = swapped !== t ? swapped : t.replace(/\bstl\b/i, 'STL File');
    }
  } else {
    t += ' STL File';
  }
  // Only add machine context when the title does not already carry it, so we
  // never produce "for CNC Carving for CNC Router".
  const hasMachine = /\b(cnc|laser|3d print|router|carving)\b/i.test(t);
  const suffix = hasMachine ? ' - Digital Download' : ' for CNC Router, Laser & 3D Printing - Digital Download';
  if (!/digital download/i.test(t) && (t + suffix).length <= 150) t += suffix;
  return t.slice(0, 150);
}

export async function GET() {
  const FALLBACK = (t: string) =>
    `${t} is a high-detail 3D bas-relief STL for CNC routers, laser engravers and 3D printers. Instant download, commercial use included. Tested in Aspire, VCarve Pro, Carveco, ArtCAM and Fusion 360.`;

  let discount = 20;
  try {
    const { data } = await supabase.from('site_settings').select('discount_percent').eq('id', 1).maybeSingle();
    if (data?.discount_percent != null) discount = Number(data.discount_percent) || 20;
  } catch {}

  // Square-image experiment: only these product ids get /sq/<slug>.jpg, so the
  // rest of the catalogue stays a clean control group.
  const squareIds = new Set<string>();
  try {
    const { supabaseAdmin } = await import('../lib/supabase');
    const { data: exp } = await supabaseAdmin().from('image_experiment').select('product_id').eq('variant', 'square');
    for (const r of exp || []) squareIds.add(String((r as any).product_id));
  } catch (e) { console.error('[google-feed] experiment lookup failed:', (e as any)?.message); }

  const items: string[] = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('products')
        .select('id, title, slug, price_usd, image_url, gallery, seo_description, description, product_categories(categories(name))')
        .eq('active', true)
        // Google's weapons policy will never approve our rifle/scope hunting
        // scenes, so sending them only accrues violations. Excluded here only;
        // they stay live on the site, Etsy, Cults and Pinterest.
        .eq('google_feed_excluded', false)
        .not('image_url', 'is', null)
        .order('slug')
        .range(from, from + 999);
      if (error) { console.error('google feed page failed:', error); break; }
      const batch = data || [];
      for (const p of batch as any[]) {
        const title = shoppingTitle(String(p.title || ''));
        const desc = stripEmoji((p.seo_description || (p.description || '').slice(0, 4800) || FALLBACK(title))).slice(0, 5000);
        const { price, original, percent } = pricing(p.price_usd, discount);
        const cats = (p.product_categories || []).map((pc: any) => pc.categories?.name).filter(Boolean).join(' > ');
        const gallery: string[] = Array.isArray(p.gallery) ? p.gallery.filter(Boolean) : [];
        const extraImgs = gallery.slice(1, 11).map((g) => `<g:additional_image_link>${xml(img(g, { w: 1200, q: 85 }))}</g:additional_image_link>`).join('');
        items.push(
          `<item>` +
          `<g:id>${xml(p.id)}</g:id>` +
          `<title>${xml(title)}</title>` +
          `<description>${xml(desc)}</description>` +
          `<link>${xml(`${SITE}/product/${p.slug}?utm_source=google&utm_medium=shopping`)}</link>` +
          `<g:image_link>${xml(squareIds.has(String(p.id)) ? `${SITE}/sq/${p.slug}.jpg` : img(p.image_url, { w: 1200, q: 85 }))}</g:image_link>` +
          extraImgs +
          `<g:availability>in_stock</g:availability>` +
          `<g:price>${original.toFixed(2)} USD</g:price>` +
          (percent > 0 ? `<g:sale_price>${price.toFixed(2)} USD</g:sale_price>` : '') +
          `<g:brand>DigitalChiselCo</g:brand>` +
          `<g:condition>new</g:condition>` +
          `<g:identifier_exists>no</g:identifier_exists>` +
          `<g:product_type>${xml(cats || 'Bas-Relief STL Files')}</g:product_type>` +
          `<g:google_product_category>${xml(GPC)}</g:google_product_category>` +
          `</item>`,
        );
      }
      if (batch.length < 1000) break;
    }
  } catch (e) { console.error('google feed failed:', e); }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">` +
    `<channel>` +
    `<title>DigitalChiselCo - Bas-Relief STL Files</title>` +
    `<link>${xml(SITE)}</link>` +
    `<description>Premium bas-relief STL files for CNC routers, laser engravers and 3D printers.</description>` +
    items.join('') +
    `</channel></rss>`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
