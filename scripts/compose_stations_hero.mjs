// The Stations hero, exact version (2026-09-26): the 14 REAL station renders,
// trimmed to the panel and placed in station order (two rows of seven) on the
// Gemini chapel wall (.mockups/stations/wall.jpg, gen_stations_wall.mjs).
// The renders themselves are not altered beyond resizing and a brightness
// match to the light where each one hangs; the shadow falls down and to the
// right, away from the window at the upper left.
//   node scripts/compose_stations_hero.mjs  -> .mockups/stations/hero-chapel.jpg
import 'dotenv/config';
import sharp from 'sharp';
const U = process.env.PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY, H = { apikey: K, authorization: `Bearer ${K}` };
const b = (await fetch(`${U}/rest/v1/products?select=id&slug=like.14-stations-of-the-cross*`, { headers: H }).then((r) => r.json()))[0];
const rows = await fetch(`${U}/rest/v1/bundle_items?select=sort_order,products:source_product_id(image_url)&bundle_product_id=eq.${b.id}&order=sort_order`, { headers: H }).then((r) => r.json());
if (rows.length !== 14) throw new Error('expected 14 stations');

const wallBuf = await sharp('.mockups/stations/wall.jpg').toBuffer();
const { width: W, height: Hh } = await sharp(wallBuf).metadata();
const lum = await sharp(wallBuf).greyscale().raw().toBuffer({ resolveWithObject: true });
const meanAt = (x, y, w, h) => { let s = 0, n = 0; for (let j = y; j < y + h; j += 4) for (let i = x; i < x + w; i += 4) { s += lum.data[j * lum.info.width + i]; n++; } return s / n; };

const x0 = Math.round(W * 0.075), x1 = Math.round(W * 0.925);
const P = Math.floor((x1 - x0) / (7 + 6 * 0.22)), G = Math.round(P * 0.22);
const top = Math.round(Hh * 0.2);
const rowGap = Math.round(P * 0.3);
const wallMean = meanAt(x0, top, x1 - x0, 2 * P + rowGap);

const layers = [];
for (let k = 0; k < 14; k++) {
  const row = k < 7 ? 0 : 1, col = k % 7;
  const x = x0 + col * (P + G), y = top + row * (P + rowGap);
  const raw = Buffer.from(await (await fetch(rows[k].products.image_url)).arrayBuffer());
  const panel = await sharp(raw).trim({ threshold: 60 }).resize(P, P, { fit: 'fill' }).toBuffer();
  // brighter where the sun falls, a touch darker in the shade, never more than +-12%
  const f = Math.max(0.88, Math.min(1.12, meanAt(x, y, P, P) / wallMean));
  const lit = await sharp(panel).modulate({ brightness: f }).toBuffer();
  // soft contact shadow, down and to the right (light from the upper left)
  const pad = Math.round(P * 0.12);
  const shadow = await sharp({ create: { width: P + pad * 2, height: P + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: P, height: P, channels: 4, background: { r: 40, g: 28, b: 18, alpha: 0.55 } } }).png().toBuffer(), left: pad, top: pad }])
    .blur(Math.max(3, P * 0.035)).png().toBuffer();
  layers.push({ input: shadow, left: x - pad + Math.round(P * 0.035), top: y - pad + Math.round(P * 0.05) });
  // panel thickness: a thin darker edge on the shadow side
  const edge = Math.max(3, Math.round(P * 0.018));
  layers.push({ input: await sharp({ create: { width: P, height: P, channels: 4, background: { r: 52, g: 30, b: 16, alpha: 1 } } }).png().toBuffer(), left: x + edge, top: y + edge });
  layers.push({ input: lit, left: x, top: y });
}
await sharp(wallBuf).composite(layers).jpeg({ quality: 92 }).toFile('.mockups/stations/hero-chapel.jpg');
console.log('wrote .mockups/stations/hero-chapel.jpg', W + 'x' + Hh, 'panel', P);
