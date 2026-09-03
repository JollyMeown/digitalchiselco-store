// Pinterest-native Pin images: /pin/<slug>.jpg
//
// Pinterest is a VERTICAL surface. Our product photos are landscape (794x596),
// so in a feed of 2:3 Pins they render small and lose the click. This endpoint
// composes each carving onto a branded 1000x1500 canvas (the 2:3 Pinterest
// recommends) with the design name and a call to action, so nothing is cropped
// and the Pin fills the slot.
//
// TEXT IS DRAWN AS PATHS, NOT <text>. Netlify functions ship with no system
// fonts, so librsvg renders every <text> glyph as a "missing glyph" box (seen
// live on Pinterest 2026-09-02). opentype.js turns each string into outline
// path data from the bundled OFL Lora font, which needs no fontconfig at all.
//
// Generated on demand and cached hard at the edge, so there is no storage cost
// and no batch job to re-run when products change.
import type { APIRoute } from 'astro';
import opentype from 'opentype.js';
import { supabase } from '../../lib/supabase';

export const prerender = false;

const W = 1000, H = 1500, MAX_TEXT_W = 880;

// Fonts are static files in public/fonts, fetched once per function instance.
let fontsP: Promise<{ reg: opentype.Font; bold: opentype.Font }> | null = null;
function loadFonts(origin: string) {
  if (!fontsP) {
    fontsP = (async () => {
      const [reg, bold] = await Promise.all(['Lora-Regular', 'Lora-Bold'].map(async (n) => {
        const r = await fetch(`${origin}/fonts/${n}.ttf`);
        if (!r.ok) throw new Error(`font ${n} ${r.status}`);
        return opentype.parse(await r.arrayBuffer());
      }));
      return { reg, bold };
    })().catch((e) => { fontsP = null; throw e; });
  }
  return fontsP;
}

type Opts = { letterSpacing?: number };
const width = (f: opentype.Font, s: string, size: number, o: Opts = {}) => f.getAdvanceWidth(s, size, o as any);
// Centred text as a filled path. y is the baseline, like SVG <text>.
const text = (f: opentype.Font, s: string, y: number, size: number, fill: string, o: Opts = {}) => {
  const w = width(f, s, size, o);
  return `<path d="${f.getPath(s, W / 2 - w / 2, y, size, o as any).toPathData(2)}" fill="${fill}"/>`;
};

// Wrap a title into at most 3 lines that fit the canvas width, measured with
// the real font instead of a character count.
function wrap(f: opentype.Font, title: string, size: number, maxLines = 3): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (width(f, cur + ' ' + w, size) <= MAX_TEXT_W) cur += ' ' + w;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1].replace(/[\s.,]+$/, '');
    while (last && width(f, last + '…', size) > MAX_TEXT_W) last = last.replace(/\s*\S+$/, '');
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

export const GET: APIRoute = async ({ params, request }) => {
  const slug = String(params.slug || '');
  const { data: p } = await supabase
    .from('products').select('title, seo_title, image_url, mockup_url, mockup_status').eq('slug', slug).eq('active', true).maybeSingle();
  if (!p?.image_url) return new Response('Not found', { status: 404 });
  // Prefer the room mockup when one exists: a carving hanging on a real wall is
  // what Pinterest rewards, and the hero's studio cloth reads as a catalogue
  // photo. Falls back to the hero, so a product without a mockup still pins.
  // Only art the owner has approved in Admin > SEO > Marketing images.
  const art = (p.mockup_status === 'approved' && p.mockup_url) ? p.mockup_url : p.image_url;

  // SEO titles are built for search and run long; a Pin needs the subject only.
  // Trim to the first clause and cut on a word boundary, never mid-word.
  // Use the full product title: many seo_title values are stored truncated
  // (e.g. "… CNC Relief S"), which would print a cut-off word on the Pin.
  const title = String(p.title || p.seo_title || '')
    .split('|')[0]
    .replace(/(cnc relief stl|3d relief stl|bas-?relief stl|relief stl|stl file).*$/i, '')
    .replace(/[\s,\-–]+$/, '')
    .trim();

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
    const origin = new URL(request.url).origin;
    const [{ reg, bold }, res] = await Promise.all([loadFonts(origin), fetch(art)]);
    if (!res.ok) throw new Error('source image ' + res.status);
    const src = Buffer.from(await res.arrayBuffer());

    // Nothing is ever cropped, but the image is capped in height: room mockups
    // come back square or portrait, and a full-width square left no room for the
    // copy, which then printed over the buttons. Fitting inside a box keeps the
    // whole design visible and guarantees space below it.
    const PHOTO_W = W, PHOTO_MAX_H = 760;
    const photo = await sharp(src).resize(PHOTO_W, PHOTO_MAX_H, { fit: 'inside', withoutEnlargement: false }).toBuffer();
    const pMeta = await sharp(photo).metadata();
    const photoH = pMeta.height || 751;
    const photoTop = 120;

    const lines = wrap(bold, title, 52);
    // Vertical space between the image and the first CTA, so the copy sits in
    // the middle of it whatever the image's shape.
    const ctaTop = makerLine ? H - 300 : H - 210;
    const blockH = lines.length * 62 + 100;
    const textTop = Math.max(
      photoTop + photoH + 70,
      photoTop + photoH + Math.round(((ctaTop - (photoTop + photoH)) - blockH) / 2) + 52,
    );
    const titleSvg = lines.map((l, i) => text(bold, l, textTop + i * 62, 52, '#2a1d10')).join('');
    const subY = textTop + lines.length * 62;

    const overlay = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#faf6ef"/><stop offset="100%" stop-color="#f0e6d6"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      ${text(reg, 'DIGITALCHISELCO', 86, 30, '#854F0B', { letterSpacing: 0.2 })}
      ${titleSvg}
      ${text(reg, 'Commercial use included', subY + 52, 33, '#6b5d4a')}
      ${text(reg, 'Aspire · VCarve · Carveco · Fusion 360', subY + 100, 33, '#6b5d4a')}
      ${makerLine ? `
      <rect x="${W / 2 - 300}" y="${H - 268}" width="600" height="76" rx="38" fill="#2c6a67"/>
      ${text(bold, 'No machine? Get it made for you', H - 218, 33, '#ffffff')}
      ${text(reg, 'Own a CNC, laser or 3D printer?', H - 152, 30, '#6b5d4a')}`
      : text(reg, '3D relief STL for CNC, laser & 3D printing', H - 168, 34, '#6b5d4a')}
      <rect x="${W / 2 - 250}" y="${H - 130}" width="500" height="82" rx="41" fill="#854F0B"/>
      ${text(bold, 'Instant download', H - 76, 36, '#ffffff')}
    </svg>`);

    const out = await sharp(overlay)
      .composite([{ input: photo, top: photoTop, left: Math.round((W - (pMeta.width || PHOTO_W)) / 2) }])
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
