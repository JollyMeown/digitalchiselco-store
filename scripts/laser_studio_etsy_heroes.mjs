// Laser Studio on Etsy: new hero images + the listing text brought to v2.9.
//
// The gallery had drifted further than the text. Two of its nine images were
// the same "11 Sellable Styles" poster (the app has 50 looks), one advertised
// the Sundial Maker and Recipe Board that the customer build hides, and three
// more still said five workspaces / 11 styles / "100% offline". Those six go;
// the three that are still true (star maps, calibration, photo prep) stay.
//
// The owner's new heroes lead, reduced from 2-3 MB PNGs to JPEGs of a few
// hundred KB. Two of the five in the folder are held back on purpose: one shows
// the beta LightBurn project export as a workflow step, the other misspells
// "Quotes" and says "send to your laser" (the app never drives the machine).
//
// Every image being removed was downloaded full size to
// scripts/laser_studio_etsy_images_backup/ first; --restore puts them back.
//
//   node --env-file=.env scripts/laser_studio_etsy_heroes.mjs            # dry run
//   node --env-file=.env scripts/laser_studio_etsy_heroes.mjs --apply
//   node --env-file=.env scripts/laser_studio_etsy_heroes.mjs --restore --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAccessToken, apiKeyHeader, etsy } from './etsy_client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SHOP = 61524055;
const LISTING = 4532421680;
const APPLY = process.argv.includes('--apply');
const RESTORE = process.argv.includes('--restore');
const BACKUP = path.join(HERE, 'laser_studio_etsy_images_backup');
const HEROES = path.join(ROOT, '.mockups', 'laser-studio', 'heroes');

const REMOVE = [8258847807, 8210923632, 8210923686, 8210924642, 8258848787, 8460618708];
const NEW = [
  { file: 'ls-hero-cnc-match-lion.jpg', alt: 'Laser Studio software by DigitalChiselCo: CNC Match lines a design up on a carved lion panel, then the laser burns the detail; 50 looks, star maps, tumbler wraps and coasters' },
  { file: 'ls-hero-cnc-match-dog.jpg', alt: 'Laser Studio CNC Match: carved on the CNC, finished on the laser; 50 looks from one photo, $40 one-time, photos never uploaded, Windows 10 and 11' },
  { file: 'ls-hero-carving-to-product.jpg', alt: 'Laser Studio turns a CNC carving into a finished laser product: align, burn, then job cards, client proofs, quotes and care cards for makers' },
];

async function call(method, url, body, headers = {}) {
  const token = await getAccessToken();
  const r = await fetch(`https://openapi.etsy.com/v3/application${url}`, {
    method, body, headers: { 'x-api-key': apiKeyHeader(), Authorization: `Bearer ${token}`, ...headers },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} ${r.status} ${text.slice(0, 250)}`);
  return text ? JSON.parse(text) : {};
}
async function upload(buf, name, rank, alt) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/jpeg' }), name);
  fd.append('rank', String(rank));
  if (alt) fd.append('alt_text', alt.slice(0, 250));
  return call('POST', `/shops/${SHOP}/listings/${LISTING}/images`, fd);
}

const live = await etsy(`/listings/${LISTING}?includes=Images`, { oauth: true });
const imgs = live.images || [];
console.log(`live: ${imgs.length} images`);

if (RESTORE) {
  const saved = JSON.parse(fs.readFileSync(path.join(BACKUP, 'images.json'), 'utf8'));
  const gone = saved.filter((s) => !imgs.some((i) => i.listing_image_id === s.listing_image_id));
  console.log(`restore: ${gone.length} saved images are missing from the listing`);
  if (!APPLY) process.exit(0);
  for (const s of gone) {
    const f = path.join(BACKUP, `r${s.rank}_${s.listing_image_id}.jpg`);
    await upload(fs.readFileSync(f), path.basename(f), Math.min(s.rank, 10), s.alt_text || '');
    console.log('restored', path.basename(f));
  }
  process.exit(0);
}

// safety: never delete an image we do not hold a full-size copy of
for (const id of REMOVE) {
  const i = imgs.find((x) => x.listing_image_id === id);
  if (!i) { console.log(`  ${id} already gone`); continue; }
  const f = path.join(BACKUP, `r${i.rank}_${id}.jpg`);
  if (!fs.existsSync(f) || fs.statSync(f).size < 50_000) { console.error(`no backup for ${id}, stopping`); process.exit(1); }
  console.log(`  remove r${i.rank} ${id} (backed up)`);
}
for (const n of NEW) {
  const f = path.join(HEROES, n.file);
  if (!fs.existsSync(f)) { console.error('missing', f); process.exit(1); }
  console.log(`  add ${n.file} ${(fs.statSync(f).size / 1e3) | 0} KB`);
}
const already = imgs.filter((i) => NEW.some((n) => (i.alt_text || '') === n.alt.slice(0, 250)));
if (already.length) { console.log('heroes already on the listing, nothing to do'); process.exit(0); }
if (!APPLY) { console.log('dry run'); process.exit(0); }

// delete first: Etsy caps a listing at 10 images and 9 + 3 would not fit
for (const id of REMOVE) {
  if (!imgs.some((x) => x.listing_image_id === id)) continue;
  await call('DELETE', `/shops/${SHOP}/listings/${LISTING}/images/${id}`);
  console.log('removed', id);
}
for (let k = 0; k < NEW.length; k++) {
  const n = NEW[k];
  await upload(fs.readFileSync(path.join(HEROES, n.file)), n.file, k + 1, n.alt);
  console.log('added', n.file, 'at rank', k + 1);
}
const after = await etsy(`/listings/${LISTING}?includes=Images`, { oauth: true });
console.log('now:', after.images.map((i) => `r${i.rank} ${i.full_width}x${i.full_height}`).join(', '));
