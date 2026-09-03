// Promotional Pin art: /pin/promo/<key>.jpg
//
// The shop's own Pinterest data (2026-09-03) says designed "hook" Pins earn
// roughly 22x the impressions per Pin of catalogue product Pins: 17 hand-made
// lifestyle Pins pulled 412 impressions while 3,023 product Pins pulled 2.77k.
// These are the automated version of that: one 1000x1500 Pin per offer, with a
// headline promising an outcome rather than describing a file.
//
// Text is drawn as font outlines, never <text>: Netlify's functions ship with
// no system fonts, so librsvg renders every glyph as a missing-glyph box.
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { supabase, supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const W = 1000, H = 1500, PAD = 70;
const TEAL = '#1c4a48', TEAL_LIGHT = '#2c6a67', BRONZE = '#854F0B', CREAM = '#f5efe3';

type Promo = {
  eyebrow: string; title: string[]; sub: string; cta: string;
  scene?: string;            // public/scenes/<scene>.jpg behind the art
  link: string;              // where the Pin sends people
  needsMarketplace?: boolean;
};

const PROMOS: Record<string, Promo> = {
  'cut-local': {
    eyebrow: 'Cut Local · maker network',
    title: ['Love a design?', 'Get it made', 'near you.'],
    sub: 'No CNC or 3D printer? Post any design and a vetted maker near you builds it. Compare quotes and star ratings, they do the making.',
    cta: 'Find a maker near you',
    scene: 'living_room',
    link: '/makers',
    needsMarketplace: true,
  },
  'get-paid': {
    eyebrow: 'Cut Local · for makers',
    title: ['Own a CNC?', 'Get paid to', 'build.'],
    sub: 'Paid jobs near you, with the design file already in hand. Free to join, the buyer pays you directly, and we take just 3% on completed jobs.',
    cta: 'Become a maker',
    scene: 'workshop',
    link: '/become-a-maker',
    needsMarketplace: true,
  },
  'free-files': {
    eyebrow: 'Free STL pack',
    title: ['Five relief', 'STL files,', 'free.'],
    sub: 'Test how our reliefs carve on your own machine before you spend anything. Ready for CNC routers, lasers and 3D printers.',
    cta: 'Download the free pack',
    scene: 'workshop',
    link: '/free',
  },
};

// Fonts live in public/fonts and are read from disk at render time.
let fontsP: Promise<{ reg: opentype.Font; bold: opentype.Font }> | null = null;
function loadFonts(origin: string) {
  if (!fontsP) {
    fontsP = (async () => {
      const read = async (name: string) => {
        const local = path.join(process.cwd(), 'public', 'fonts', `${name}.ttf`);
        if (fs.existsSync(local)) return opentype.parse(fs.readFileSync(local).buffer.slice(0));
        const r = await fetch(`${origin}/fonts/${name}.ttf`);
        if (!r.ok) throw new Error(`font ${name} ${r.status}`);
        return opentype.parse(await r.arrayBuffer());
      };
      const [reg, bold] = await Promise.all([read('Lora-Regular'), read('Lora-Bold')]);
      return { reg, bold };
    })().catch((e) => { fontsP = null; throw e; });
  }
  return fontsP;
}

// ls is in EM units (opentype.js convention), e.g. 0.16 = wide tracking.
const widthOf = (f: opentype.Font, s: string, size: number, ls = 0) => f.getAdvanceWidth(s, size, { letterSpacing: ls } as any);
const pathAt = (f: opentype.Font, s: string, x: number, y: number, size: number, fill: string, ls = 0) =>
  `<path d="${f.getPath(s, x, y, size, { letterSpacing: ls } as any).toPathData(2)}" fill="${fill}"/>`;
const centered = (f: opentype.Font, s: string, y: number, size: number, fill: string, ls = 0) =>
  pathAt(f, s, W / 2 - widthOf(f, s, size, ls) / 2, y, size, fill, ls);

/** Wrap to lines that fit `max` px, measured with the real font. */
function wrap(f: opentype.Font, text: string, size: number, max: number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (widthOf(f, `${cur} ${w}`, size) <= max) cur += ` ${w}`;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

export const GET: APIRoute = async ({ params, request }) => {
  const key = String(params.key || '');
  const p = PROMOS[key];
  if (!p) return new Response('Not found', { status: 404 });

  if (p.needsMarketplace) {
    try {
      const { data: gs } = await supabaseAdmin().from('growth_settings').select('marketplace_enabled').eq('id', 1).maybeSingle();
      if (!gs?.marketplace_enabled) return new Response('Not found', { status: 404 });
    } catch { return new Response('Not found', { status: 404 }); }
  }

  let sharp: any;
  try { sharp = (await import('sharp')).default; } catch { return new Response('Unavailable', { status: 503 }); }

  try {
    const origin = new URL(request.url).origin;
    const { reg, bold } = await loadFonts(origin);

    // Backdrop: a generated empty room, darkened so white type reads over it.
    // Falls back to the flat brand gradient when the scene file is missing.
    let base = sharp({ create: { width: W, height: H, channels: 3, background: TEAL } });
    if (p.scene) {
      const file = path.join(process.cwd(), 'public', 'scenes', `${p.scene}.jpg`);
      if (fs.existsSync(file)) {
        base = sharp(await sharp(fs.readFileSync(file)).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer());
      }
    }

    // A carving to prove what this is about: the newest active design.
    let productBuf: Buffer | null = null;
    try {
      const { data: prod } = await supabase.from('products')
        .select('image_url').eq('active', true).not('image_url', 'is', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (prod?.image_url) {
        const r = await fetch(prod.image_url);
        if (r.ok) {
          // Whole design, never a crop: heroes are 4:3 and 1:1 today and may be
          // portrait tomorrow, and a cropped hero advertises a design that is
          // not the one on sale.
          const fitted = await sharp(Buffer.from(await r.arrayBuffer()))
            .resize(600, 440, { fit: 'inside', withoutEnlargement: false })
            .toBuffer();
          const fm = await sharp(fitted).metadata();
          productBuf = await sharp({ create: { width: 620, height: 460, channels: 4, background: { r: 22, g: 16, b: 8, alpha: 1 } } })
            .composite([
              { input: fitted, left: Math.round((620 - (fm.width || 620)) / 2), top: Math.round((460 - (fm.height || 460)) / 2) },
              { input: Buffer.from(`<svg width="620" height="460"><rect width="620" height="460" rx="18" fill="#fff"/></svg>`), blend: 'dest-in' },
            ])
            .png().toBuffer();
        }
      }
    } catch { /* the Pin still works without the photo */ }

    const titleSize = 78, subSize = 30;
    const subLines = wrap(reg, p.sub, subSize, W - PAD * 2 - 40, 4);
    const titleTop = 300;
    const photoTop = titleTop + p.title.length * 86 + 40;
    const subTop = photoTop + (productBuf ? 500 : 60);

    const overlay = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0d1615" stop-opacity="0.94"/>
          <stop offset="45%" stop-color="#0d1615" stop-opacity="0.80"/>
          <stop offset="100%" stop-color="#0d1615" stop-opacity="0.95"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#shade)"/>

      <!-- eyebrow -->
      <rect x="${W / 2 - (widthOf(reg, p.eyebrow.toUpperCase(), 26, 0.16) + 64) / 2}" y="150" rx="34"
        width="${widthOf(reg, p.eyebrow.toUpperCase(), 26, 0.16) + 64}" height="62"
        fill="${TEAL_LIGHT}" fill-opacity="0.35" stroke="#9fe0d9" stroke-opacity="0.45"/>
      ${centered(reg, p.eyebrow.toUpperCase(), 191, 26, '#a8e5dd', 0.16)}

      <!-- headline -->
      ${p.title.map((l, i) => centered(bold, l, titleTop + i * 86, titleSize, '#ffffff')).join('')}

      <!-- subheading -->
      ${subLines.map((l, i) => centered(reg, l, subTop + i * 42, subSize, 'rgba(245,239,227,0.82)')).join('')}

      <!-- CTA -->
      <rect x="${W / 2 - (widthOf(bold, p.cta, 36) + 96) / 2}" y="${H - 250}" rx="46"
        width="${widthOf(bold, p.cta, 36) + 96}" height="92" fill="${BRONZE}"/>
      ${centered(bold, p.cta, H - 190, 36, '#ffffff')}

      ${centered(reg, 'digitalchiselco.com', H - 96, 27, 'rgba(245,239,227,0.6)', 0.08)}
    </svg>`);

    const layers: any[] = [{ input: overlay, top: 0, left: 0 }];
    if (productBuf) layers.push({ input: productBuf, top: photoTop, left: Math.round((W - 620) / 2) });

    const out = await sharp(await base.jpeg().toBuffer())
      .composite(layers)
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();

    return new Response(out, {
      headers: {
        'content-type': 'image/jpeg',
        // The featured carving changes with the catalogue, so keep this fresher
        // than product Pin art.
        'cache-control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch (e) {
    console.error('[pin-promo]', (e as any)?.message);
    return new Response('Render failed', { status: 500 });
  }
};

export const PROMO_KEYS = Object.keys(PROMOS);
export { PROMOS };
