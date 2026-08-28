// One-off: create the FREE Vase Lampshade Studio DEMO listing on Cults3D.
// Reuses the proven createCreation flow from cults3d_upload.mjs.
//   node scripts/cults3d_lamp_studio_demo.mjs            # dry run (prints payload)
//   node scripts/cults3d_lamp_studio_demo.mjs --apply    # LIVE
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const ENDPOINT = 'https://cults3d.com/graphql';
const USER = process.env.CULTS3D_USERNAME || '';
const KEY = process.env.CULTS3D_API_KEY || '';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DigitalChiselCo-uploader';
if (!USER || !KEY) { console.error('Set CULTS3D_USERNAME / CULTS3D_API_KEY in .env'); process.exit(1); }

const DRIVE_ID = '1Q6X8w_D6BKCpIr5AbyK8hX7SAZE-eO-j';
const FILE_NAME = 'VaseLampshadeStudio-DEMO-v1.0.zip';
const SITE = 'https://www.digitalchiselco.com/lamp-studio';

const fileUrl = GOOGLE_API_KEY
  ? `https://www.googleapis.com/drive/v3/files/${DRIVE_ID}?alt=media&key=${GOOGLE_API_KEY}&filename=${encodeURIComponent(FILE_NAME)}`
  : `https://drive.usercontent.com/download?id=${DRIVE_ID}&export=download&confirm=t&filename=${encodeURIComponent(FILE_NAME)}`;

const payload = {
  name: 'Vase Lampshade Studio - FREE Lamp Shade Generator - 105 Designs, Built-in E27/E14 Fitter',
  description: `FREE DEMO of Vase Lampshade Studio — a complete Windows app for designing watertight, 3D-printable lampshades with the bulb holder BUILT IN.

★ WHAT MAKES IT SPECIAL
The E27/E14 fitter is fused into the shade, and the app computes your slicer's exact vase-mode settings (solid bottom layers = ring height ÷ layer height) — so the whole lamp prints in ONE continuous piece: no supports, no glue, no assembly.

★ THIS FREE DEMO INCLUDES THE FULL DESIGNER
• 105 parametric lamp shapes — ogee bells, twisted stars, pumpkins, nautilus spirals, basket weaves & more
• Lithophane mode — emboss any photo so it glows when lit
• Curved custom text — names & dates, glowing, raised or engraved
• Draw-your-own profile editor + trace from any image
• 11 stackable modifiers, lit-glow preview, printer-bed fit check (Ender / Prusa / Bambu presets)
• 100% offline — nothing is ever uploaded

★ THE FULL VERSION adds watertight STL / OBJ / 3MF export of YOUR designs, the one-piece fitter files, per-design PDF print guides with computed slicer settings, and a commercial licence (sell every lamp you design).

▶ GET THE FULL VERSION — or try the playground in your browser first:
${SITE}

Install: run the Setup exe inside the ZIP (Windows 10/11). SmartScreen may ask once — "More info → Run anyway".`,
  imageUrls: [1, 2, 3, 4, 5, 6, 7].map(n => `https://digitalchiselco.com/lamp-studio/gallery-${n}.jpg`),
  fileUrls: [fileUrl],
  locale: 'EN',
  categoryId: 'Q2F0ZWdvcnkvMzA',          // Home
  downloadPrice: 0,                        // FREE
  currency: 'USD',
  licenseCode: 'cults_cu',
  tagNames: ['lampshade', 'lamp', 'vase mode', 'lamp shade', 'lithophane', 'e27', 'generator', 'software', 'home decor', 'light'],
  usages: ['3dp'],
  visibility: 'PUBLIC',
};

const MUTATION = `
mutation Create($name:String!,$description:String!,$imageUrls:[String!]!,$fileUrls:[String!]!,$locale:LocaleEnum!,$categoryId:ID!,$downloadPrice:Float,$currency:CurrencyEnum,$licenseCode:String,$tagNames:[String!],$usages:[String!],$visibility:CreationVisibilityEnum){
  createCreation(name:$name, description:$description, imageUrls:$imageUrls, fileUrls:$fileUrls, locale:$locale, categoryId:$categoryId, downloadPrice:$downloadPrice, currency:$currency, licenseCode:$licenseCode, tagNames:$tagNames, usages:$usages, visibility:$visibility, madeWithAi:true){
    creation { id url(locale:$locale) }
    errors
  }
}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function gql(query, variables) {
  let last = '';
  for (let a = 0; a < 4; a++) {
    if (a) await sleep(2500 * a);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA,
        authorization: 'Basic ' + Buffer.from(`${USER}:${KEY}`).toString('base64') },
      body: JSON.stringify({ query, variables }),
    });
    last = await res.text();
    try {
      const j = JSON.parse(last);
      if (j.errors) throw new Error(JSON.stringify(j.errors));
      return j.data;
    } catch (e) {
      if (a < 3 && (res.status === 403 || res.status === 429 || res.status >= 500)) { console.log(`(Cults ${res.status} — retry)`); continue; }
      throw new Error(e.message || last.slice(0, 300));
    }
  }
  throw new Error(last.slice(0, 300));
}

if (!APPLY) {
  console.log('DRY RUN — payload:');
  console.log(JSON.stringify({ ...payload, description: payload.description.slice(0, 200) + '…' }, null, 2));
  console.log('\nRun with --apply to create the listing.');
} else {
  // warm the image CDN so Cults3D fetches them reliably
  await Promise.all(payload.imageUrls.map(u => fetch(u).then(r => r.arrayBuffer()).catch(() => {})));
  const d = await gql(MUTATION, payload);
  const c = d.createCreation;
  if (c.errors?.length) { console.error('ERRORS:', c.errors); process.exit(1); }
  console.log('LISTED:', c.creation.url);
}
