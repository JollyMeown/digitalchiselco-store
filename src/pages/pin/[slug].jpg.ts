// Pinterest-native Pin images: /pin/<slug>.jpg
//
// Pinterest is a VERTICAL surface. Our product photos are landscape (794x596),
// so in a feed of 2:3 Pins they render small and lose the click. This endpoint
// composes each carving onto a branded 1000x1500 canvas (the 2:3 Pinterest
// recommends) with the design name and a call to action, so nothing is cropped
// and the Pin fills the slot.
//
// Generated on demand and cached hard at the edge, so there is no storage cost
// and no batch job to re-run when products change.
import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

const W = 1000, H = 1500;
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Wrap a title into at most 3 lines that fit the canvas width.
function wrap(title: string, perLine = 22, maxLines = 3): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= perLine) cur += ' ' + w;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s.,]+$/, '') + '…';
  }
  return lines;
}

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug || '');
  const { data: p } = await supabase
    .from('products').select('title, seo_title, image_url').eq('slug', slug).eq('active', true).maybeSingle();
  if (!p?.image_url) return new Response('Not found', { status: 404 });

  const title = String(p.seo_title || p.title || '').split('|')[0].trim();

  // Cut Local second door: most of Pinterest does not own a CNC. When the
  // marketplace is live the Pin also speaks to them, which is the difference
  // between "not for me" and a click. Gated like every other Cut Local surface.
  let makerLine = false;
  try {
    // growth_settings is RLS-locked to admin, so this needs the service client
    const { supabaseAdmin } = await import('../../lib/supabase');
    const { data: gs } = await supabaseAdmin().from('growth_settings').select('marketplace_enabled').eq('id', 1).maybeSingle();
    makerLine = !!gs?.marketplace_enabled;
  } catch {}

  let sharp: any;
  try { sharp = (await import('sharp')).default; }
  catch { return new Response(null, { status: 302, headers: { location: p.image_url } }); }

  try {
    const res = await fetch(p.image_url);
    if (!res.ok) throw new Error('source image ' + res.status);
    const src = Buffer.from(await res.arrayBuffer());

    // The carving runs full-bleed across the upper half, nothing cropped.
    const PHOTO_W = W;
    const photo = await sharp(src).resize(PHOTO_W, null, { fit: 'inside', withoutEnlargement: false }).toBuffer();
    const pMeta = await sharp(photo).metadata();
    const photoH = pMeta.height || 751;
    const photoTop = 120;

    const lines = wrap(title);
    const textTop = photoTop + photoH + 78;
    const titleSvg = lines.map((l, i) =>
      `<text x="${W / 2}" y="${textTop + i * 62}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="52" font-weight="bold" fill="#2a1d10">${esc(l)}</text>`
    ).join('');

    const overlay = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#faf6ef"/><stop offset="100%" stop-color="#f0e6d6"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <text x="${W / 2}" y="86" text-anchor="middle" font-family="Georgia, serif" font-size="30" letter-spacing="6" fill="#854F0B">DIGITALCHISELCO</text>
      ${titleSvg}
      <text x="${W / 2}" y="${textTop + lines.length * 62 + 52}" text-anchor="middle" font-family="Georgia, serif" font-size="33" fill="#6b5d4a">Commercial use included</text>
      <text x="${W / 2}" y="${textTop + lines.length * 62 + 100}" text-anchor="middle" font-family="Georgia, serif" font-size="33" fill="#6b5d4a">Aspire · VCarve · Carveco · Fusion 360</text>
      ${makerLine ? `
      <rect x="${W / 2 - 300}" y="${H - 268}" width="600" height="76" rx="38" fill="#2c6a67"/>
      <text x="${W / 2}" y="${H - 218}" text-anchor="middle" font-family="Georgia, serif" font-size="33" font-weight="bold" fill="#ffffff">No machine? Get it made for you</text>
      <text x="${W / 2}" y="${H - 152}" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="#6b5d4a">Own a CNC, laser or 3D printer?</text>`
      : `<text x="${W / 2}" y="${H - 168}" text-anchor="middle" font-family="Georgia, serif" font-size="34" fill="#6b5d4a">3D relief STL for CNC, laser &amp; 3D printing</text>`}
      <rect x="${W / 2 - 250}" y="${H - 130}" width="500" height="82" rx="41" fill="#854F0B"/>
      <text x="${W / 2}" y="${H - 76}" text-anchor="middle" font-family="Georgia, serif" font-size="36" font-weight="bold" fill="#ffffff">Instant download</text>
    </svg>`);

    const out = await sharp(overlay)
      .composite([{ input: photo, top: photoTop, left: Math.round((W - PHOTO_W) / 2) }])
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();

    return new Response(out, {
      headers: {
        'content-type': 'image/jpeg',
        // long cache: the Pin art only changes when we change this template
        'cache-control': 'public, max-age=86400, s-maxage=2592000, immutable',
      },
    });
  } catch (e) {
    console.error('[pin-image]', (e as any)?.message);
    // never break a feed: fall back to the original product photo
    return new Response(null, { status: 302, headers: { location: p.image_url } });
  }
};
