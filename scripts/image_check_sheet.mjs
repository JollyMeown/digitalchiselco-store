// Visual check of new BRS uploads: one contact sheet row per product with its
// MAIN photo next to two plain renders of its own design, numbered and titled,
// so a product showing another design's photo stands out at a glance.
// Pair with image_audit_recent.mjs (sizes, broken links, same file on two
// products). Owner rule 2026-09-25: double-check every BRS upload.
//   node scripts/image_check_sheet.mjs <out-dir> [--days 9]
// Red square = that picture did not download (re-check before calling it broken).
import 'dotenv/config';
import fs from 'node:fs';
import sharp from 'sharp';
const U = process.env.PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DIR = process.argv[2];
const DAYS = Number(process.argv.includes('--days') ? process.argv[process.argv.indexOf('--days') + 1] : 9);
const since = new Date(Date.now() - DAYS * 86400e3).toISOString().slice(0, 10);
const ps = await fetch(`${U}/rest/v1/products?select=slug,title,image_url,gallery&created_at=gte.${since}&order=created_at.desc`, { headers: { apikey: K, authorization: `Bearer ${K}` } }).then((r) => r.json());
const T = 118, PER_ROW = 6, ROWS = 11, CELL = T * 3 + 14, LAB = 16;
const th = async (u) => {
  if (!u) return sharp({ create: { width: T, height: T, channels: 3, background: '#ddd' } }).png().toBuffer();
  for (let t = 0; t < 3; t++) try {
    const r = await fetch(u.replace('/object/public/', '/render/image/public/') + `?width=${T}&height=${T}&resize=contain&quality=55`);
    return await sharp(Buffer.from(await r.arrayBuffer())).resize(T, T, { fit: 'contain', background: '#fff' }).png().toBuffer();
  } catch {}
  return sharp({ create: { width: T, height: T, channels: 3, background: '#f00' } }).png().toBuffer();
};
const items = ps.map((p) => { const all = [p.image_url, ...(p.gallery || []).filter((u) => u !== p.image_url)]; return { slug: p.slug, title: p.title, urls: [all[0], all[4] || all[1], all[5] || all[2]] }; });
fs.writeFileSync(DIR + '/sheet_index.json', JSON.stringify(items.map((x, i) => ({ n: i + 1, slug: x.slug, title: x.title })), null, 1));
let q = 0; const thumbs = new Array(items.length);
await Promise.all(Array.from({ length: 8 }, async () => { while (q < items.length) { const i = q++; thumbs[i] = await Promise.all(items[i].urls.map(th)); } }));
const perSheet = PER_ROW * ROWS;
for (let s = 0; s * perSheet < items.length; s++) {
  const comp = [];
  for (let k = 0; k < perSheet; k++) {
    const i = s * perSheet + k; if (i >= items.length) break;
    const x = (k % PER_ROW) * CELL, y = Math.floor(k / PER_ROW) * (T + LAB);
    comp.push({ input: Buffer.from(`<svg width="${CELL}" height="${LAB}"><text x="2" y="12" font-size="12" font-family="Arial" font-weight="bold" fill="#b00">${i + 1}</text><text x="30" y="12" font-size="10" font-family="Arial" fill="#333">${items[i].title.replace(/[&<>"]/g, '').slice(0, 52)}</text></svg>`), left: x, top: y });
    thumbs[i].forEach((b, j) => comp.push({ input: b, left: x + j * T, top: y + LAB }));
  }
  await sharp({ create: { width: CELL * PER_ROW, height: (T + LAB) * ROWS, channels: 3, background: '#fff' } }).composite(comp).jpeg({ quality: 82 }).toFile(`${DIR}/sheet_${s + 1}.jpg`);
  console.log('sheet', s + 1);
}
setTimeout(() => process.exit(0), 100);
