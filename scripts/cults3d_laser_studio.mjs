// Laser Studio on Cults3D, as a paid listing in Various > Software.
//
// Delivery is the same download PDF the Etsy listing ships (it points at the
// always-newest installer on Drive). That PDF carries the installer link, so it
// is NEVER put at a public URL: it goes into the private `software` bucket and
// Cults is handed a signed URL that expires in an hour, long enough for Cults
// to fetch and store its own copy.
//
// Created SECRET (hidden) so the owner reviews it before anyone can buy;
// --publish flips the existing listing to PUBLIC. A ledger stops a second
// listing being created if the script runs twice.
//
//   node scripts/cults3d_laser_studio.mjs              # dry run
//   node scripts/cults3d_laser_studio.mjs --apply      # create, hidden
//   node scripts/cults3d_laser_studio.mjs --publish    # owner approved: go public
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const APPLY = process.argv.includes('--apply');
const PUBLISH = process.argv.includes('--publish');
const LEDGER = path.join(ROOT, 'cults3d_laser_studio_done.json');
const U = process.env.PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = { apikey: K, authorization: `Bearer ${K}` };
const USER = process.env.CULTS3D_USERNAME, KEY = process.env.CULTS3D_API_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const PDF = 'D:/000 BUNDLE RELIEF STUDIO/_config/quick_pdfs/Laser-Studio-Software-Download-DigitalChiselCo.pdf';
const PDF_KEY = 'cults/Laser-Studio-Software-Download-DigitalChiselCo.pdf';

// gallery: the three heroes lead, then two real pictures (the app itself and
// a burned carving), converted to JPEG because Cults does not take WebP
const IMAGES = [
  ['ls-hero-cnc-match-lion', path.join(ROOT, '.mockups/laser-studio/heroes/ls-hero-cnc-match-lion.jpg')],
  ['ls-hero-cnc-match-dog', path.join(ROOT, '.mockups/laser-studio/heroes/ls-hero-cnc-match-dog.jpg')],
  ['ls-hero-carving-to-product', path.join(ROOT, '.mockups/laser-studio/heroes/ls-hero-carving-to-product.jpg')],
  ['ls-app-cnc-match', path.join(ROOT, 'public/laser-studio/app-v26.webp')],
  ['ls-cnc-burned-panel', path.join(ROOT, 'public/laser-studio/cnc-burned-panel.webp')],
];

const NAME = 'Laser Studio - Photo, STL & Star Map to Laser Files Software for Windows - CNC Match, 50 Looks, LightBurn Ready';
const DESCRIPTION = `Laser Studio by DigitalChiselCo is a Windows desktop app that turns photos, STL 3D models and the real night sky into ready-to-burn laser files. One-time purchase, free updates, no subscription.

WHAT YOU DOWNLOAD
A PDF with your download link for the Laser Studio installer (about 364 MB) and the install steps. Windows 10 or 11, 64-bit. There is no Mac or Linux version.

CNC MATCH (new in 2.7, improved in 2.8 and 2.9)
Carved it on the CNC? Finish it on the laser.
1. Load the greyscale file of the relief you carved
2. Photograph the piece on the laser bed, straight down, or use your laser camera view
3. Find the board corners so the photo is measurable in millimetres or inches
4. Auto-fit finds the piece and drops the design onto it, offline, and tells you how sure it is
5. Choose what to burn: darkened floor, scorched tops, outline, shading or your own text
6. Export for LightBurn with alignment helpers, in one ZIP
New in 2.8: stretch width or height on its own when the carving came out a little different from the file.
New in 2.9: tell it which laser software you use (LightBurn with or without a camera, WeCreat and others) and the export opens with the steps for that one.
Honest note: Auto-fit is a starting guess, not a promise. Alignment is typically within about a millimetre. Check the outline and test on scrap before burning the finished piece.

50 LOOKS FROM ONE PHOTO
2 photo modes (engrave, 3D illusion), 17 art engines (pencil sketch, stipple, word portrait, spiral, string art, crosshatch, halftone, mosaic, one-line scribble, maze and more) and 31 signature styles (banknote engraving, hedcut, embroidery stitch, charcoal, Celtic weave, circuit board and more).

ALSO INSIDE
- STL to laser: a hand-carved looking greyscale relief engrave from any STL, with movable light
- Star maps from a real place, date and time
- Tumbler wraps with true circumference, coasters and coaster sets with cut lines
- Game board maker: chess, checkers and cribbage boards
- AI background removal with a touch-up brush and region tools, all on your own PC
- Smart Upscale x4 for small photos
- Calibration: power/speed test grid, focus ramp, kerf comb, line interval test
- Seller tools: laser job cards with your logo, quote PDFs, client proofs with scan-to-approve QR, care cards
- Dark mode, millimetres or inches, English, Spanish, German and French
- Illustrated user manual and CNC Match guide built in

WORKS WITH
Diode, CO2, fibre and galvo lasers. Exports files for LightBurn, xTool Creative Space, Glowforge, LaserGRBL and RDWorks. Laser Studio prepares the files; your own laser software runs the machine.

PRIVACY
Your photos and files are processed on your own PC and never uploaded. The app goes online only to check for updates and to download the upscaler model once.

Power and speed settings are never guessed for you: the built-in test grid lets you find the right ones for your own machine and material.

Licence: for one person on their own computers. You may sell what you make with it. You may not share or resell the installer.`;

async function gql(query, variables) {
  let last = '';
  for (let a = 0; a < 4; a++) {
    if (a) await new Promise((r) => setTimeout(r, 2500 * a));
    const res = await fetch('https://cults3d.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA,
        authorization: 'Basic ' + Buffer.from(`${USER}:${KEY}`).toString('base64') },
      body: JSON.stringify({ query, variables }),
    });
    last = await res.text();
    if (!res.ok && (res.status === 403 || res.status === 429 || res.status >= 500)) continue;
    const j = JSON.parse(last);
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
    return j.data;
  }
  throw new Error(last.slice(0, 300));
}

const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : null;

if (PUBLISH) {
  if (!ledger?.id) { console.error('no listing in the ledger yet; run --apply first'); process.exit(1); }
  const d = await gql(`mutation($id:ID!){ updateCreation(id:$id, visibility:PUBLIC){ creation { id url(locale:EN) } errors } }`, { id: ledger.id });
  const c = d.updateCreation;
  if (c.errors?.length) { console.error(c.errors); process.exit(1); }
  fs.writeFileSync(LEDGER, JSON.stringify({ ...ledger, visibility: 'PUBLIC', publishedAt: new Date().toISOString() }, null, 1));
  console.log('PUBLIC:', c.creation.url);
  process.exit(0);
}

if (ledger?.id) { console.log('already created:', ledger.url, `(${ledger.visibility})`); process.exit(0); }
if (/—/.test(NAME + DESCRIPTION)) { console.error('em dash in copy'); process.exit(1); }
if (!fs.existsSync(PDF)) { console.error('delivery PDF missing:', PDF); process.exit(1); }
for (const [, f] of IMAGES) if (!fs.existsSync(f)) { console.error('missing image', f); process.exit(1); }
console.log(`name (${NAME.length} chars): ${NAME}`);
console.log(`description: ${DESCRIPTION.length} chars, ${IMAGES.length} images, price $40, Various > Software, SECRET`);
if (!APPLY) { console.log('dry run'); process.exit(0); }

// images: public, they are marketing pictures
const imageUrls = [];
for (const [name, f] of IMAGES) {
  const buf = await sharp(f).flatten({ background: '#1a110a' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const key = `cults/laser-studio/${name}.jpg`;
  const r = await fetch(`${U}/storage/v1/object/site-media/${key}`, { method: 'POST', headers: { ...SB, 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: buf });
  if (!r.ok) throw new Error(`image upload ${r.status} ${await r.text()}`);
  imageUrls.push(`${U}/storage/v1/object/public/site-media/${key}`);
}
// delivery PDF: private bucket + one-hour signed URL
{
  const r = await fetch(`${U}/storage/v1/object/software/${PDF_KEY}`, { method: 'POST', headers: { ...SB, 'content-type': 'application/pdf', 'x-upsert': 'true' }, body: fs.readFileSync(PDF) });
  if (!r.ok) throw new Error(`pdf upload ${r.status} ${await r.text()}`);
}
const signed = await fetch(`${U}/storage/v1/object/sign/software/${PDF_KEY}`, { method: 'POST', headers: { ...SB, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) }).then((r) => r.json());
if (!signed.signedURL) throw new Error('could not sign the PDF url');
const fileUrl = `${U}/storage/v1${signed.signedURL}&download=Laser-Studio-Software-Download-DigitalChiselCo.pdf`;

const d = await gql(`mutation Create($name:String!,$description:String!,$imageUrls:[String!]!,$fileUrls:[String!]!,$locale:LocaleEnum!,$categoryId:ID!,$subCategoryIds:[ID!],$downloadPrice:Float,$currency:CurrencyEnum,$licenseCode:String,$tagNames:[String!],$usages:[String!],$visibility:CreationVisibilityEnum){
  createCreation(name:$name, description:$description, imageUrls:$imageUrls, fileUrls:$fileUrls, locale:$locale, categoryId:$categoryId, subCategoryIds:$subCategoryIds, downloadPrice:$downloadPrice, currency:$currency, licenseCode:$licenseCode, tagNames:$tagNames, usages:$usages, visibility:$visibility, madeWithAi:true){
    creation { id url(locale:EN) }
    errors
  }
}`, {
  name: NAME, description: DESCRIPTION, imageUrls, fileUrls: [fileUrl], locale: 'EN',
  categoryId: 'Q2F0ZWdvcnkvMjk', subCategoryIds: ['Q2F0ZWdvcnkvNw'],      // Various > Software
  downloadPrice: 40, currency: 'USD', licenseCode: 'cults_cu',
  tagNames: ['laser engraving', 'laser software', 'lightburn', 'laser', 'engraving', 'stl to laser', 'photo engraving', 'star map', 'cnc', 'xtool', 'glowforge', 'laser files'],
  usages: ['cnc_laser'], visibility: 'SECRET',
});
const c = d.createCreation;
if (c.errors?.length) { console.error('ERRORS:', c.errors); process.exit(1); }
fs.writeFileSync(LEDGER, JSON.stringify({ id: c.creation.id, url: c.creation.url, visibility: 'SECRET', createdAt: new Date().toISOString() }, null, 1));
console.log('CREATED (hidden):', c.creation.url);
