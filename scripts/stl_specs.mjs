// Measure a design's STL and store what a maker needs to know before cutting.
//
// Born from a customer message on 2026-09-11: "I did not get an information PDF
// about the design. Is there one available?" There was not. The delivery PDF is
// a download guide, and neither it nor the product page said how big the model
// is or how deep it carves. All of it is in the file.
//
// Runs LOCALLY: the models are 50 to 100 MB each, so this is a deliberate,
// one-off measurement per design, never a per-page-view job.
//
//   node scripts/stl_specs.mjs --slug <slug>       one product
//   node scripts/stl_specs.mjs --missing 20        the next 20 without specs
//   node scripts/stl_specs.mjs --slug <slug> --dry report, store nothing
//
// ONLY the Google Drive file behind the product's own link is measured, and
// that is deliberate. A copy of the same design sitting on a BRS machine can be
// an earlier or later export, so measuring it would describe a file the buyer
// never receives. A local-disk mode was written and removed on 2026-09-11 for
// exactly that reason (owner: "only google drive with link"). It measured 306
// designs from disk and every one of them was cleared again. Do not add it back:
// slow and true beats fast and wrong when the number is printed on a product
// page as fact.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes('--dry');

const driveDl = (id) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
const idOf = (u) => (u ? (u.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || u.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] || null : null);

/** Bounding box + triangle count from a binary STL already in memory. */
function measure(buf) {
  if (buf.length < 84) return null;
  // an ASCII STL starts with "solid" and has no triangle count; ours are binary
  if (buf.subarray(0, 5).toString('ascii').toLowerCase() === 'solid' && buf.length < 1000) return null;
  const tri = buf.readUInt32LE(80);
  if (84 + tri * 50 !== buf.length) return null;   // not a well-formed binary STL
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tri; i++) {
    const o = 84 + i * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(o + v * 12), y = buf.readFloatLE(o + v * 12 + 4), z = buf.readFloatLE(o + v * 12 + 8);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const width = +(maxX - minX).toFixed(2), height = +(maxY - minY).toFixed(2), depth = +(maxZ - minZ).toFixed(2);
  return {
    width, height, depth,
    // The file carries no unit. These models are exported in millimetres and a
    // maker scales them to their own panel anyway, so the number that actually
    // travels is the SHAPE: the aspect ratio, and the depth as a share of width.
    units: 'mm (as exported; scale to your panel)',
    aspect: +(width / height).toFixed(3),
    orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square',
    depth_pct_of_width: +((100 * depth) / width).toFixed(1),
    triangles: tri,
    file_mb: +(buf.length / 1048576).toFixed(1),
    // a relief should sit flat on the blank: its lowest point at zero
    base_flat: Math.abs(minZ) < 0.01,
    // provenance, so a future reader never has to wonder which file was read
    source: 'drive',
    measured_at: new Date().toISOString(),
  };
}

async function stlLinkFor(productId) {
  const { data: dls } = await db.from('product_downloads').select('file_name, download_link, drive_file_id').eq('product_id', productId);
  for (const d of dls || []) {
    const link = String(d.download_link || '');
    // a Drive link is the STL itself; a Supabase PDF is the download guide, and
    // the real file sits behind the button inside it
    if (/drive\.google|drive\.usercontent/.test(link)) return driveDl(idOf(link) || d.drive_file_id);
    if (/\.pdf($|\?)/i.test(link) && d.drive_file_id) return driveDl(d.drive_file_id);
  }
  return null;
}

async function run(p) {
  const url = await stlLinkFor(p.id);
  if (!url) { console.log(`  ${p.slug}: no downloadable file`); return false; }
  const r = await fetch(url);
  if (!r.ok) { console.log(`  ${p.slug}: download failed (${r.status})`); return false; }
  const buf = Buffer.from(await r.arrayBuffer());
  const specs = measure(buf);
  if (!specs) { console.log(`  ${p.slug}: not a binary STL (${(buf.length / 1048576).toFixed(1)} MB)`); return false; }
  console.log(`  ${String(p.title).slice(0, 46).padEnd(46)} ${specs.width} x ${specs.height} x ${specs.depth} | ${specs.orientation} | depth ${specs.depth_pct_of_width}% of width | ${specs.triangles.toLocaleString()} triangles | ${specs.file_mb} MB${specs.base_flat ? '' : ' | BASE NOT AT ZERO'}`);
  if (DRY) return true;
  const { error } = await db.from('products').update({ model_specs: specs }).eq('id', p.id);
  if (error) { console.log(`     store failed: ${error.message}`); return false; }
  return true;
}

const slug = arg('--slug');
const missing = Number(arg('--missing') || 0);
if (slug) {
  const { data: p } = await db.from('products').select('id, slug, title').eq('slug', slug).maybeSingle();
  if (!p) { console.error('no product with that slug'); process.exit(1); }
  await run(p);
} else if (missing > 0) {
  // proven sellers first: the designs people actually ask about
  const { data: ps } = await db.from('products')
    .select('id, slug, title, etsy_sales_365')
    .is('model_specs', null).eq('active', true).gt('price_usd', 0)
    .order('etsy_sales_365', { ascending: false, nullsFirst: false })
    .limit(missing);
  console.log(`measuring ${ps?.length || 0} designs (best sellers first)`);
  let ok = 0;
  for (const p of ps || []) { if (await run(p)) ok++; }
  console.log(`\n${ok} measured and stored`);
} else {
  console.log('usage: --slug <slug> | --missing <n> [--dry]');
}
