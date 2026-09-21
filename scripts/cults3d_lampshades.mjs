// Publish the 12 free vase-mode lampshades to Cults3D.
//
// Separate from cults3d_upload.mjs because that one builds listings from
// `products` rows, and these twelve are deliberately NOT products: they are
// free models whose job is to reach 3D-printing people and point them back at
// the Studio. Same GraphQL mutation, same Drive-file trick.
//
// Cults3D fetches every asset from a URL, so the pictures are pushed to
// Supabase storage first and the STL zips are served from Drive through
// drive.usercontent.com, which exposes a real filename and extension.
//
//   node scripts/cults3d_lampshades.mjs --images        # push pictures to Supabase
//   node scripts/cults3d_lampshades.mjs                 # DRY RUN, writes a preview
//   node scripts/cults3d_lampshades.mjs --apply         # create them, SECRET
//   node scripts/cults3d_lampshades.mjs --apply --visibility PUBLIC
//
// Created SECRET by default: the owner reviews on Cults3D and flips each one
// public. See the standing rule, drafts only.
//
// NOTE: needs the VPN OFF. cults3d.com does not resolve through it.
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ENDPOINT = 'https://cults3d.com/graphql';
const USER = process.env.CULTS3D_USERNAME || '';
const KEY = process.env.CULTS3D_API_KEY || '';
const URL_BASE = process.env.PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'site-media';

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? d) : d; };
const APPLY = args.includes('--apply');
const VISIBILITY = val('visibility', 'SECRET');
const CATEGORY_ID = val('category-id', 'Q2F0ZWdvcnkvMzA');   // Home
const LICENSE_CODE = val('license-code', 'CC-BY-NC-ND');
const LOCALE = 'EN';

const SHOTS = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/lamp-shots';
const POSTERS = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/lamp-posters';
const REPORT = JSON.parse(readFileSync('D:/LAMP SHADE OGEE/studio/_pack/_report.json', 'utf8'));
const LEDGER = path.join(process.cwd(), 'cults3d_lampshades_done.json');

// Drive file ids, one zip per design (uploaded 2026-09-21 via BRS drive_upload_file.py)
const DRIVE = {
  'ogee-bell': '1ZNUKOyPx1YB4pk5JUpHonEpEtS5ZINKR',
  'twisted-star': '1YTpWaeZln5qFqM9kOiYKTnDRKxdLCYS2',
  'nautilus-spiral': '1EYfJFu17sFU2UWXI8tBK0rEyV4uGPrU4',
  'basket-weave': '1ff-Q0NNo-BrW5RdGwkrKLwD8ix6NgBLK',
  'barley-twist': '1pLJAFnyRv9JnxuvvjRF1QwFLCr9OSQE6',
  'tulip-flare': '1zCZp3mE_j67Nbmy1Zh-yLNbgZKVmm_1W',
  'onion-dome': '1VdAd89w43aCPL2KOv53ri8_CFkx9kyxE',
  'fan-pleats': '1TxdnBvM1CcZ_l9hmiLaoh9ocBaPeRNQx',
  'faceted-drum': '1RaBzfDZzjQ1lLyoB5AUKORd5UkXfAhVz',
  'cable-column': '1hhKq9BT97xdOwylKIcLoV0Lv_MAFOQyU',
  'pinecone': '1ZPInBsXhlSoYW2MrfpPg8s7c215kg6RE',
  'bamboo': '13SkHHJ9FtM7f942x5p4NnnMAiOwIk27H',
};

const driveFile = (id, name) =>
  `https://drive.usercontent.com/download?id=${id}&export=download&confirm=t&filename=${encodeURIComponent(name)}`;

const pub = (key) => `${URL_BASE}/storage/v1/object/public/${BUCKET}/${key}`;

async function pushImage(localPath, key) {
  const body = readFileSync(localPath);
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
    body,
  });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  return pub(key);
}

const TAGS = [
  'lampshade', 'lamp shade', 'vase mode', 'spiralize', 'pendant light', 'lamp',
  'e27', 'light shade', 'home decor', 'lighting', 'one piece print', 'no supports',
];

function description(d) {
  return `${d.name} is a 3D printable lampshade that prints as ONE continuous piece, with the E27 bulb holder already part of the model. No separate ring to print, no glue, no supports, nothing to assemble.

WHY IT IS DIFFERENT
Every other lampshade file leaves you printing a bulb holder separately and gluing it in, where it never quite sits straight. This one fuses a spoked E27 holder into the bottom of the shade, so the whole lamp comes off the bed finished.

THE ONE SETTING YOU NEED
Print it in vase mode (Spiralize Outer Contour in Cura, Spiral vase in PrusaSlicer and Orca, Spiral mode in Bambu Studio) and set your SOLID BOTTOM LAYERS so the holder prints solid before the spiral starts:

    solid bottom layers = holder height / layer height

The holder is 10 mm tall, so at 0.2 mm layers that is 50, and at 0.3 mm layers it is 34. That is the whole trick.

SIZE
${d.h} mm tall, ${d.dia} mm across at its widest, bottom opening ${d.open} mm.
Fits a 220 x 220 x 250 mm bed (Ender 3 and similar) with room to spare.

WHAT IS IN THE DOWNLOAD
  - ${d.key}_combined.stl    shade and holder as one piece, print this one
  - ${d.key}_shade_vase.stl  the shade alone, single wall
  - ${d.key}_fitter_E27.stl  the holder alone, if you print the two separately
  - READ ME FIRST.txt with the full settings

SETTINGS THAT MATTER
  Extrusion width  0.6 to 0.8 mm. This is your wall thickness and it controls
                   how much light gets through. Thicker blocks the glow.
  Layer height     0.2 mm for a fine even texture, 0.3 mm for a bolder rib
  Temperature      5 to 10 C above your normal, a single wall cools fast
  Cooling          100 percent
  Speed            30 to 40 mm/s, slower gives a visibly more even wall
  Filament         natural, white or pale. Dark colours block the light.

SAFETY
Use LED bulbs only. PLA softens at around 60 C and an incandescent or halogen
bulb will deform it. A 6 to 9 W LED is plenty. Leave an air gap between the
bulb and the wall, and use a proper E27 holder, flex and switch.

Watertight closed manifold, so your slicer opens it with no repair step and no
warnings. Free for personal use.

Made in Vase Lampshade Studio, which generates the shade and fits the bulb
holder to whatever shape you make.`;
}

const CREATE = `
mutation Create($name:String!,$description:String!,$imageUrls:[String!]!,$fileUrls:[String!]!,$locale:LocaleEnum!,$categoryId:ID!,$downloadPrice:Float,$currency:CurrencyEnum,$licenseCode:String,$tagNames:[String!],$visibility:CreationVisibilityEnum){
  createCreation(name:$name, description:$description, imageUrls:$imageUrls, fileUrls:$fileUrls, locale:$locale, categoryId:$categoryId, downloadPrice:$downloadPrice, currency:$currency, licenseCode:$licenseCode, tagNames:$tagNames, visibility:$visibility, madeWithAi:true){
    creation { id url(locale:$locale) }
    errors
  }
}`;

async function gql(query, variables) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Basic ' + Buffer.from(`${USER}:${KEY}`).toString('base64'),
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

// ── build the payloads ─────────────────────────────────────────────────────
const IMAGES_ONLY = args.includes('--images');
const payloads = [];
for (const d of REPORT) {
  const id = DRIVE[d.key];
  if (!id) { console.error(`no Drive id for ${d.key}`); continue; }
  const imgs = [
    { local: path.join(POSTERS, `${d.key}_etsy.jpg`), key: `lamps/${d.key}-poster.jpg` },
    { local: path.join(SHOTS, `${d.key}_pendant.jpg`), key: `lamps/${d.key}-pendant.jpg` },
    { local: path.join(SHOTS, `${d.key}_lit.jpg`), key: `lamps/${d.key}-lit.jpg` },
  ].filter((i) => existsSync(i.local));
  payloads.push({
    key: d.key,
    name: `${d.name} Lampshade - One Piece Vase Mode with Built-in E27 Holder`,
    description: description(d),
    imageLocals: imgs,
    imageUrls: imgs.map((i) => pub(i.key)),
    fileUrls: [driveFile(id, `VaseLampshadeStudio_${d.key}.zip`)],
    downloadPrice: 0,
    currency: 'USD',
    tagNames: TAGS,
  });
}

if (IMAGES_ONLY) {
  for (const p of payloads) {
    for (const i of p.imageLocals) {
      const u = await pushImage(i.local, i.key);
      console.log('pushed', u);
    }
  }
  console.log(`\n${payloads.length} designs, images pushed to Supabase.`);
  process.exit(0);
}

if (!APPLY) {
  writeFileSync('cults3d-lampshades-preview.json', JSON.stringify(payloads, null, 2));
  console.log(`DRY RUN. ${payloads.length} listings ready -> cults3d-lampshades-preview.json`);
  console.log(`visibility would be ${VISIBILITY}, price 0.00 (free), licence ${LICENSE_CODE}`);
  console.log('run with --apply --category-id <ID> once the VPN is off.');
  process.exit(0);
}

if (!CATEGORY_ID) { console.error('need --category-id (run cults3d_upload.mjs --list-categories)'); process.exit(1); }
const LIMIT = Number(val('limit', 0)) || Infinity;
const done = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
let made = 0;
for (const p of payloads) {
  if (made >= LIMIT) break;
  if (done[p.key]) { console.log(`skip ${p.key} (already at ${done[p.key].url})`); continue; }
  try {
    for (const i of p.imageLocals) await pushImage(i.local, i.key);
    const res = await gql(CREATE, {
      name: p.name, description: p.description, imageUrls: p.imageUrls, fileUrls: p.fileUrls,
      locale: LOCALE, categoryId: CATEGORY_ID, downloadPrice: p.downloadPrice, currency: p.currency,
      licenseCode: LICENSE_CODE, tagNames: p.tagNames, visibility: VISIBILITY,
    });
    const c = res.createCreation;
    if (c.errors?.length) throw new Error(JSON.stringify(c.errors).slice(0, 200));
    done[p.key] = { id: c.creation.id, url: c.creation.url, at: new Date().toISOString() };
    writeFileSync(LEDGER, JSON.stringify(done, null, 2));
    console.log(`OK ${p.key} -> ${c.creation.url}`);
    made++;
  } catch (e) {
    console.error(`FAIL ${p.key}: ${e.message.slice(0, 200)}`);
  }
  await new Promise((r) => setTimeout(r, 4000));
}
console.log('\ndone. Review each listing on Cults3D, then flip it to public.');
