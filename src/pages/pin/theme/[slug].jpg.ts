// Themed collage Pin art: /pin/theme/<category-slug>.jpg
//
// One Pin per theme (hunting, ducks, dogs, cowboy, fishing …), showing four
// real designs from that category on a generated room backdrop, headlined by
// the theme and linked to that collection page. This is the format the shop's
// own Pinterest data rewards: designed Pins that promise a subject, not
// catalogue photos of a single file.
//
// Nothing here is AI-invented: the carvings are the real product photos, so a
// pinner who clicks finds exactly the designs they saw. Only the empty room
// behind them is generated, once, by scripts/gen_pin_scenes.mjs.
//
// Text is drawn as font outlines because Netlify's functions carry no fonts.
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { supabase } from '../../../lib/supabase';
import { cropToSubject } from '../../../lib/subject-crop';

export const prerender = false;

const W = 1000, H = 1500;
const BRONZE = '#854F0B';
const SCENES = ['living_room', 'cabin', 'farmhouse', 'man_cave', 'workshop', 'office', 'bedroom', 'entryway'];

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

// ls is in EM units (opentype.js convention).
const widthOf = (f: opentype.Font, s: string, size: number, ls = 0) => f.getAdvanceWidth(s, size, { letterSpacing: ls } as any);
const centered = (f: opentype.Font, s: string, y: number, size: number, fill: string, ls = 0) =>
  `<path d="${f.getPath(s, W / 2 - widthOf(f, s, size, ls) / 2, y, size, { letterSpacing: ls } as any).toPathData(2)}" fill="${fill}"/>`;

/** Split a theme name into at most two centred lines that fit the canvas. */
function titleLines(f: opentype.Font, text: string, size: number, max: number): string[] {
  if (widthOf(f, text, size) <= max) return [text];
  const words = text.split(/\s+/);
  for (let i = words.length - 1; i > 0; i--) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    if (widthOf(f, a, size) <= max && widthOf(f, b, size) <= max) return [a, b];
  }
  return [text];
}

// Category names carry shop shorthand ("STL", "Decor"); Pins read better with
// the plain subject, so trim the noise but never invent a different subject.
const cleanName = (n: string) => String(n || '')
  .replace(/\b(stl|3d|files?)\b/gi, '')
  .replace(/\s{2,}/g, ' ')
  .replace(/\s*&\s*/g, ' & ')
  .trim();

export const GET: APIRoute = async ({ params, request }) => {
  const slug = String(params.slug || '');
  const { data: cat } = await supabase.from('categories').select('id, name, slug, mockup_url, mockup_status').eq('slug', slug).maybeSingle();
  if (!cat) return new Response('Not found', { status: 404 });

  // Category membership lives in the product_categories join table.
  const { data: prods, count } = await supabase
    .from('products')
    .select('title, image_url, mockup_url, mockup_status, etsy_sales_365, product_categories!inner(category_id)', { count: 'exact' })
    .eq('active', true).eq('product_categories.category_id', cat.id)
    .not('image_url', 'is', null)
    .order('etsy_sales_365', { ascending: false })
    .limit(60);
  const pool = (prods || []).filter((p: any) => p.image_url);
  if (pool.length < 2) return new Response('Not enough designs', { status: 404 });

  let sharp: any;
  try { sharp = (await import('sharp')).default; } catch { return new Response('Unavailable', { status: 503 }); }

  try {
    const { reg, bold } = await loadFonts(new URL(request.url).origin);

    // Deterministic per theme and per day: the collage changes daily without a
    // random seed, so the same day always renders the same Pin (cache-friendly).
    const day = Math.floor(Date.now() / 86_400_000);
    const seed = [...slug].reduce((a, c) => a + c.charCodeAt(0), 0) + day;
    const pick = <T,>(arr: T[], n: number): T[] => {
      const out: T[] = [];
      for (let i = 0; i < n && arr.length; i++) out.push(arr[(seed * (i + 3) + i * 7) % arr.length]);
      return out;
    };
    // Categories are broad: "Vintage & WWII Planes" also holds hot rods and
    // tractors, so taking whatever is newest published a plane-titled Pin full
    // of trucks. Prefer designs whose own title echoes the theme name, then the
    // best sellers, and only then anything else in the category.
    const stop = new Set(['and', 'the', 'stl', '3d', 'art', 'wall', 'decor', 'files', 'file', 'series', 'carvings', 'carving']);
    const themeWords = cleanName(cat.name).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !stop.has(w));
    // The LAST word of a category name is the specific one ("Vintage & WWII
    // Planes"), so weight it heavily: otherwise a hot rod scores on "vintage"
    // just as highly as a bomber scores on "planes".
    const key = themeWords[themeWords.length - 1] || '';
    const sing = (w: string) => (w.endsWith('s') ? w.slice(0, -1) : w);
    const scored = pool.map((p: any) => {
      const t = String(p.title || '').toLowerCase();
      let hits = themeWords.filter((w) => t.includes(sing(w))).length;
      if (key && t.includes(sing(key))) hits += 3;
      return { p, hits, sales: Number(p.etsy_sales_365) || 0 };
    }).sort((a, b) => (b.hits - a.hits) || (b.sales - a.sales));
    // Rotate daily through the best-matching dozen so the Pin stays fresh
    // without ever dropping to an off-theme design.
    // If the category holds four or more designs that actually name the theme,
    // the collage is built only from those: a Pin titled "Planes" must not
    // rotate a motorcycle in tomorrow.
    const onTheme = scored.filter((x) => x.hits >= 3);
    const bench = onTheme.length >= 4 ? onTheme : scored;
    const shortlist = bench.slice(0, Math.max(4, Math.min(12, bench.length))).map((x) => x.p);
    const chosen = pick(shortlist, 4);
    const scene = SCENES[seed % SCENES.length];

    // Backdrop
    const sceneFile = path.join(process.cwd(), 'public', 'scenes', `${scene}.jpg`);
    const baseBuf = fs.existsSync(sceneFile)
      ? await sharp(fs.readFileSync(sceneFile)).resize(W, H, { fit: 'cover', position: 'attention' }).jpeg().toBuffer()
      : await sharp({ create: { width: W, height: H, channels: 3, background: '#1a1208' } }).jpeg().toBuffer();

    // 2x2 collage of real designs, rounded and evenly gapped.
    const GAP = 18, CW = 420, CH = 330;
    const gridLeft = Math.round((W - (CW * 2 + GAP)) / 2), gridTop = 470;
    const tiles = await Promise.all(chosen.map(async (p: any, i: number) => {
      try {
        const useMockup = p.mockup_status === 'approved' && p.mockup_url;
        const r = await fetch(useMockup || p.image_url);
        if (!r.ok) return null;
        // Trim the studio cloth so four heroes read as one considered grid
        // rather than four different amounts of fabric. Room mockups are left
        // alone: their surroundings ARE the picture.
        const raw = Buffer.from(await r.arrayBuffer());
        const src = useMockup ? raw : await cropToSubject(sharp, raw);
        // NEVER crop a hero. The catalogue mixes 4:3 and 1:1 (and future art may
        // be portrait), and cropping to a fixed tile silently cuts elements off
        // the design a pinner is being sold. Fit the whole image inside the tile
        // and letterbox it on a warm card instead.
        const img = await sharp(src)
          .resize(CW - 16, CH - 16, { fit: 'inside', withoutEnlargement: false })
          .toBuffer();
        const meta = await sharp(img).metadata();
        const tile = await sharp({ create: { width: CW, height: CH, channels: 4, background: { r: 26, g: 18, b: 8, alpha: 1 } } })
          .composite([{ input: img, left: Math.round((CW - (meta.width || CW)) / 2), top: Math.round((CH - (meta.height || CH)) / 2) }])
          .png().toBuffer();
        const rounded = await sharp(tile)
          .composite([{ input: Buffer.from(`<svg width="${CW}" height="${CH}"><rect width="${CW}" height="${CH}" rx="16" fill="#fff"/></svg>`), blend: 'dest-in' }])
          .png().toBuffer();
        return {
          input: rounded,
          left: gridLeft + (i % 2) * (CW + GAP),
          top: gridTop + Math.floor(i / 2) * (CH + GAP),
        };
      } catch { return null; }
    }));
    const layers = tiles.filter(Boolean) as any[];
    if (!layers.length) return new Response('No images', { status: 404 });

    const name = cleanName(cat.name);
    const lines = titleLines(bold, name, 72, W - 120);
    const total = count || pool.length;
    const eyebrow = `${total}+ designs`;
    const cta = 'See the collection';
    const titleTop = 250;

    const overlay = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0d0a05" stop-opacity="0.93"/>
          <stop offset="38%" stop-color="#0d0a05" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="#0d0a05" stop-opacity="0.95"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#shade)"/>

      <rect x="${W / 2 - (widthOf(reg, eyebrow.toUpperCase(), 25, 0.16) + 60) / 2}" y="140" rx="32"
        width="${widthOf(reg, eyebrow.toUpperCase(), 25, 0.16) + 60}" height="58"
        fill="#2c6a67" fill-opacity="0.35" stroke="#f0c98a" stroke-opacity="0.4"/>
      ${centered(reg, eyebrow.toUpperCase(), 178, 25, '#f0c98a', 0.16)}

      ${lines.map((l, i) => centered(bold, l, titleTop + i * 82, 72, '#ffffff')).join('')}
      ${centered(reg, 'Bas-relief STL files for CNC, laser & 3D printing', titleTop + lines.length * 82 + 6, 28, 'rgba(245,239,227,0.8)')}

      <rect x="${W / 2 - (widthOf(bold, cta, 36) + 96) / 2}" y="${H - 235}" rx="46"
        width="${widthOf(bold, cta, 36) + 96}" height="92" fill="${BRONZE}"/>
      ${centered(bold, cta, H - 175, 36, '#ffffff')}
      ${centered(reg, 'digitalchiselco.com', H - 88, 26, 'rgba(245,239,227,0.6)', 0.08)}
    </svg>`);

    const out = await sharp(baseBuf)
      .composite([{ input: overlay, top: 0, left: 0 }, ...layers])
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();

    return new Response(out, {
      headers: {
        'content-type': 'image/jpeg',
        // The collage rotates daily, so cache for a day, not a month.
        'cache-control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch (e) {
    console.error('[pin-theme]', (e as any)?.message);
    return new Response('Render failed', { status: 500 });
  }
};
