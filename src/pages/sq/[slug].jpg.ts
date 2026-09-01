// Square Google Shopping image: /sq/<slug>.jpg
//
// Google fits product images into a SQUARE tile and letterboxes rather than
// crops, so our 794x596 landscape photos lose the top and bottom of the tile
// and the carving ends up occupying roughly a third of it. Competitors with
// square, tightly framed images look twice the size in the same grid.
//
// Orientation varies across the catalogue (landscape, near-square, the odd
// portrait), so a fixed centre crop would decapitate some pieces. sharp's
// `attention` strategy picks the region of highest visual interest instead,
// which on these photos is the carved panel rather than the draped cloth.
//
// STRICTLY no text, logo, border or watermark: Google's image policy bans all
// promotional overlay, and violating it would disapprove products. (That is the
// exact opposite of /pin/<slug>.jpg, which is built for Pinterest.)
import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;
const SIZE = 1200;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug || '');
  const { data: p } = await supabase
    .from('products').select('image_url').eq('slug', slug).eq('active', true).maybeSingle();
  if (!p?.image_url) return new Response('Not found', { status: 404 });

  let sharp: any;
  try { sharp = (await import('sharp')).default; }
  catch { return new Response(null, { status: 302, headers: { location: p.image_url } }); }

  try {
    const res = await fetch(p.image_url);
    if (!res.ok) throw new Error('source ' + res.status);
    const src = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(src).metadata();

    // Very wide panels (a long relief strip) would lose their ends to any
    // square crop, so those are letterboxed onto a matching warm background
    // instead of being cut. Everything else is attention-cropped to fill.
    const ratio = (meta.width || 1) / (meta.height || 1);
    const out = ratio > 1.9 || ratio < 0.55
      ? await sharp(src)
          .resize(SIZE, SIZE, { fit: 'contain', background: { r: 244, g: 241, b: 234 } })
          .jpeg({ quality: 88, mozjpeg: true }).toBuffer()
      : await sharp(src)
          .resize(SIZE, SIZE, { fit: 'cover', position: sharp.strategy.attention })
          .jpeg({ quality: 88, mozjpeg: true }).toBuffer();

    return new Response(out, {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=86400, s-maxage=2592000, immutable',
      },
    });
  } catch (e) {
    console.error('[sq-image]', (e as any)?.message);
    return new Response(null, { status: 302, headers: { location: p.image_url } });
  }
};
