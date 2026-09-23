// Bring the Etsy Laser Studio listing up to date with the shipped app (v2.7).
//
// The listing was written for v2.0 and has drifted in three ways, one of which
// is a promise the software does not keep:
//
//  1. MISSING. CNC Match with AI Auto-fit is the headline feature of 2.7 and
//     the listing does not mention it at all. It is also the only feature that
//     ties the laser software to the STL files the same shop sells, which makes
//     it the most commercially useful paragraph on the page.
//  2. UNDERSOLD. The listing says "11 Sellable Styles". The app now has 50:
//     2 photo modes, 17 art engines and 31 signature styles.
//  3. WRONG. It advertises a Sundial Maker and a Recipe Board. Both are hidden
//     in the customer build, so a buyer paying $40 for the listed features does
//     not get two of them. That is the part worth fixing first, whatever else
//     changes.
//
//   node scripts/laser_studio_etsy_update.mjs            # dry run, shows a diff
//   node scripts/laser_studio_etsy_update.mjs --apply    # write to Etsy
//   node scripts/laser_studio_etsy_update.mjs --revert   # put the old copy back
//
// The original description is saved beside this script before anything is sent,
// so a revert never depends on Etsy still holding the old text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAccessToken, apiKeyHeader, etsy } from './etsy_client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP = path.join(HERE, 'laser_studio_etsy_backup.json');
const LISTING = 4532421680;
const SHOP = 61524055;
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const live = await etsy(`/listings/${LISTING}`, { oauth: true });

if (REVERT) {
  if (!fs.existsSync(BACKUP)) { console.error('no backup to revert to'); process.exit(1); }
  const old = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  if (!APPLY) { console.log('dry run: would restore the description saved at', old.savedAt); process.exit(0); }
  await patch({ description: old.description });
  console.log('reverted to the copy saved at', old.savedAt);
  process.exit(0);
}

async function patch(fields) {
  const token = await getAccessToken();
  const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP}/listings/${LISTING}`, {
    method: 'PATCH',
    headers: { 'x-api-key': apiKeyHeader(), Authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 250)}`);
  return JSON.parse(text);
}

let d = live.description;
const before = d;
const changes = [];

// ── 1. the version line, so the listing dates itself ─────────────────────
if (!/VERSION 2\.7/i.test(d)) {
  d = d.replace('🚀 DigitalChiselCo proudly brings you Laser Studio',
    '⭐ NOW VERSION 2.7, with CNC Match and AI Auto-fit\n\n🚀 DigitalChiselCo proudly brings you Laser Studio');
  changes.push('added the version line');
}

// ── 2. CNC Match, the whole reason 2.7 exists ────────────────────────────
const CNC = `
🪵 NEW IN 2.7 — CNC MATCH WITH AI AUTO-FIT

Carved it on the CNC? Finish it on the laser.

Put the carved piece on your laser bed, photograph it straight down, and Laser Studio burns text, shading or the same picture exactly onto the carving. A name and a date under a pet portrait. A darkened background that makes the relief jump off the board. A scorched edge along the raised tops. The finishing touches that turn a carving into a gift.

How it works:

1️⃣ Load the greyscale file of the relief you carved
2️⃣ Photograph the piece on the laser, straight down, or use your laser camera view
3️⃣ Find the board corners so the photo is measurable in real millimetres or inches
4️⃣ The built-in AI finds your piece and drops the design onto it, offline, and tells you how sure it is
5️⃣ Choose what to burn: darkened floor, scorched tops, outline, tonal shading or your own text
6️⃣ Export for LightBurn, with the alignment helpers, in one ZIP

What you get:

✅ Burn files in greyscale and three dithered versions, at the carving's real size
✅ A "ghost" outline file for lining the burn up in your laser's camera view
✅ Optional registration marks for LightBurn Print and Cut
✅ Optional jig file, so repeat orders drop straight into place
✅ A saved preset to reload the same job later
✅ The burn previewed live on the real piece before the laser fires

Honest note on Auto-fit: it is a starting guess, not a promise. A clamp, a bright offcut, a sheet of paper or a hand in the shot can fool it, and square pieces sometimes land a quarter turn out. It tells you how confident it is and you can nudge it by hand. Alignment is typically within about a millimetre. Always check the outline and test on scrap before burning the finished piece.

`;
if (!/CNC MATCH/i.test(d)) {
  d = d.replace('\n🌟 What Is Laser Studio?', `${CNC}\n🌟 What Is Laser Studio?`);
  changes.push('added the CNC Match section');
}

// ── 3. 11 styles became 50 ───────────────────────────────────────────────
const stylesStart = d.indexOf('🖼️ 11 Sellable Styles From One Photo');
const stylesEnd = d.indexOf('✂️ AI Background Removal');
if (stylesStart > -1 && stylesEnd > stylesStart) {
  const NEW_STYLES = `🖼️ 50 Finished Looks From One Photo

Turn one customer photo into a shelf full of different products.

📷 Photo modes (2)
✨ Engrave Photo
✨ 3D Illusion

🎨 Art engines (17)
✨ Pencil Sketch, Stipple Dots, Word Portrait, Spiral Art, String Art, Crosshatch, Halftone, Mosaic, One-Line Scribble, Flow Silk, Maze, ASCII Art, Low-Poly Geometric, Contour / Topographic and more

🖋️ Signature art styles (31)
✨ Banknote Engraving, Hedcut, Embroidery Stitch, Charcoal, Turing Patterns, Lichtenberg Branches, Guilloché Rosettes, Celtic Weave, Circuit Board, Marbling, Double Exposure and more

This means one photo can become portraits, memorial gifts, wedding keepsakes, wall art, puzzle gifts, plaques, signs, coasters and more.

`;
  d = d.slice(0, stylesStart) + NEW_STYLES + d.slice(stylesEnd);
  changes.push('replaced "11 Sellable Styles" with the 50 looks');
}

// ── 4. stop advertising what the customer build does not ship ────────────
const SUNDIAL = `☀️ Sundial Maker

Create a working sundial with hour lines calculated from real solar geometry.

`;
const RECIPE = `📝 Recipe Board

Convert handwritten recipes into clean engraved recipe boards.

`;
for (const [name, block] of [['Sundial Maker', SUNDIAL], ['Recipe Board', RECIPE]]) {
  if (d.includes(block)) { d = d.replace(block, ''); changes.push(`removed ${name}, which is hidden in the customer build`); }
}

// ── 5. the summary list should name the new headline feature ─────────────
if (!/🔥 CNC Match/.test(d)) {
  d = d.replace('🔥 Photo engraving', '🔥 CNC Match: burn onto pieces you carved\n🔥 Photo engraving');
  changes.push('added CNC Match to the "why buy" summary');
}


// ── 6. five workspaces became seven ──────────────────────────────────────
if (d.includes('🛠️ Five Powerful Workspaces')) {
  d = d.replace('🛠️ Five Powerful Workspaces', '🛠️ Seven Powerful Workspaces');
  changes.push('five workspaces -> seven');
}
if (!/5️⃣ Coasters/.test(d)) {
  d = d.replace('5️⃣ My Shop', `5️⃣ Coasters

Design single coasters or matching sets with a live preview and the cut lines included.

6️⃣ CNC Match

Burn onto the pieces you carved on your CNC. See the section above.

7️⃣ My Shop`);
  changes.push('added the Coasters and CNC Match workspaces');
}

// ── 7. the comfort and seller features the listing never mentioned ───────
if (!/Smart Upscale/.test(d)) {
  d = d.replace('💻 System & Delivery', `🧰 More In Version 2.7

✅ Smart Upscale x4 for small or soft source photos
✅ Laser Job Card carrying your own logo
✅ Quote PDF for customer estimates
✅ Client proof with a scan-to-approve QR code
✅ Work in millimetres or inches
✅ Project save and open, with undo and redo
✅ Command palette (Ctrl+K)
✅ Dark mode
✅ English, Spanish, German and French
✅ On-canvas rulers
✅ Free automatic updates, with update notices since v2.0
✅ Illustrated user manual, plus a separate illustrated CNC Match Guide built into the app

💻 System & Delivery`);
  changes.push('added the 2.7 seller and comfort features');
}

// ── 8. "100% offline" is not quite true, so say what is true ─────────────
// The app checks for updates and downloads the upscaler model once. Claiming
// a flat 100% offline is the kind of small overstatement that earns a bad
// review from the one customer who runs it on an air-gapped machine.
if (d.includes('✅ 100% offline')) {
  d = d.replace('✅ 100% offline', '✅ Runs offline: your photos and files are processed on your own PC and never uploaded');
  changes.push('qualified the "100% offline" claim');
}
if (d.includes('✅ Works completely offline')) {
  d = d.replace('✅ Works completely offline',
    '✅ Works without an internet connection. The only two times it reaches out are the update check and a one-time download of the upscaler model');
  changes.push('stated the two exceptions to working offline');
}


// ── 9. no em dashes anywhere, including the ones already there ───────────
// A house rule, and this rewrite is the moment to clear the eight that the
// original copy carried. The replacement is chosen per phrase rather than
// globally, because a blanket comma reads badly in a folder list.
const DASH = [
  ['Laser Studio — the laser software', 'Laser Studio, the laser software'],
  ['laser files — directly on your own computer', 'laser files, directly on your own computer'],
  ['image conversion — it helps', 'image conversion. It helps'],
  ['One ZIP Export — Zero Confusion', 'One ZIP Export, Zero Confusion'],
  ['folder — ', 'folder: '],
];
for (const [from, to] of DASH) { while (d.includes(from)) d = d.replace(from, to); }
if (d.includes('—')) { d = d.split(' — ').join(', ').split('—').join(', '); }
if (before.includes('—')) changes.push('removed every em dash, including the eight already in the copy');

// ── report ───────────────────────────────────────────────────────────────
console.log(`Laser Studio listing ${LISTING} — ${live.state}, $${(live.price.amount / live.price.divisor).toFixed(2)}, ${live.views} views\n`);
if (!changes.length) { console.log('nothing to change; the listing already matches the app.'); process.exit(0); }
for (const c of changes) console.log('  • ' + c);
console.log(`\ndescription: ${before.length} chars -> ${d.length} chars`);

const stillClaims = ['Sundial', 'Recipe Board', '11 Sellable', 'Five Powerful', '100% offline', '—'].filter((t) => d.includes(t));
if (stillClaims.length) { console.error('\nSTOPPING: still claims', stillClaims.join(', ')); process.exit(1); }

if (!APPLY) {
  fs.writeFileSync(path.join(HERE, 'laser_studio_new_description.txt'), d);
  console.log('\nDRY RUN. Proposed copy written to scripts/laser_studio_new_description.txt');
  console.log('Run again with --apply to send it to Etsy.');
  process.exit(0);
}

fs.writeFileSync(BACKUP, JSON.stringify({
  savedAt: new Date().toISOString(), listing_id: LISTING,
  title: live.title, tags: live.tags, description: before,
}, null, 1));
await patch({ description: d });
console.log('\napplied. Old copy saved to scripts/laser_studio_etsy_backup.json');
console.log('Revert with: node scripts/laser_studio_etsy_update.mjs --revert --apply');
