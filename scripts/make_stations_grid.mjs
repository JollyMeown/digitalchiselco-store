// The 14 Stations of the Cross bundle: a clean grid of all 14 real station
// renders, in order, for the Google Shopping picture (2026-09-26). Google
// rejects promotional text, watermarks and borders, so: no text, no frame,
// light neutral ground, square. Nothing is generated or retouched: each tile
// is the station's own main picture, resized.
//   node scripts/make_stations_grid.mjs   -> .mockups/stations/grid.jpg
import 'dotenv/config';
import sharp from 'sharp';
import fs from 'node:fs';
const U = process.env.PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY, H = { apikey: K, authorization: `Bearer ${K}` };
const bundle = (await fetch(`${U}/rest/v1/products?select=id&slug=like.14-stations-of-the-cross*`, { headers: H }).then((r) => r.json()))[0];
const rows = await fetch(`${U}/rest/v1/bundle_items?select=sort_order,products:source_product_id(title,image_url)&bundle_product_id=eq.${bundle.id}&order=sort_order`, { headers: H }).then((r) => r.json());
if (rows.length !== 14) { console.error('expected 14 stations, got', rows.length); process.exit(1); }
const S = 2000, GAP = 34, TILE = 440;                       // square canvas, rows of 4-4-3-3
const layout = [4, 4, 3, 3];
const tiles = await Promise.all(rows.map(async (r) => {
  const u = r.products.image_url.replace('/object/public/', '/render/image/public/') + `?width=${TILE * 2}&height=${TILE * 2}&resize=cover&quality=92`;
  return sharp(Buffer.from(await (await fetch(u)).arrayBuffer())).resize(TILE, TILE, { fit: 'cover' }).toBuffer();
}));
const comp = []; let k = 0;
const totalH = layout.length * TILE + (layout.length - 1) * GAP;
layout.forEach((n, row) => {
  const w = n * TILE + (n - 1) * GAP, x0 = Math.round((S - w) / 2), y = Math.round((S - totalH) / 2) + row * (TILE + GAP);
  for (let i = 0; i < n; i++) comp.push({ input: tiles[k++], left: x0 + i * (TILE + GAP), top: y });
});
await sharp({ create: { width: S, height: S, channels: 3, background: '#F4F1EC' } }).composite(comp).jpeg({ quality: 90 }).toFile('.mockups/stations/grid.jpg');
console.log('wrote .mockups/stations/grid.jpg', rows.map((r) => r.sort_order).join(','));
