// Put Laser Studio in the catalog so the site can sell it through the normal
// path: cart, Paddle checkout, order email, the buyer's account.
//
// Created INACTIVE on purpose. checkout-init only accepts active products, so
// nothing can be bought until the owner has seen the page and the flow and
// flips it on. That is the review gate the sell brief asks for, enforced by
// the checkout itself rather than by anyone remembering.
//
// The download row uses the Drive /view link, not uc?export=download. For a
// file this size Google cannot virus-scan it and the direct-download form
// lands on a warning interstitial instead of the file; /view opens Drive's
// own page with a Download button, which is what the brief supplies.
//
// The link lives ONLY in product_downloads, which reaches the order email and
// the buyer's account. Nothing public carries it.
//
//   node scripts/create_laser_studio_product.mjs            # dry run
//   node scripts/create_laser_studio_product.mjs --apply
//   node scripts/create_laser_studio_product.mjs --activate --apply   # go live
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const U = cfg('PUBLIC_SUPABASE_URL');
const K = cfg('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: K, authorization: `Bearer ${K}`, 'content-type': 'application/json' };
const APPLY = process.argv.includes('--apply');
const ACTIVATE = process.argv.includes('--activate');

const SLUG = 'software-laser-studio';
const DRIVE_ID = '1nzi0B_oDoPi1H7ptQSyUBxXGPq7diN-_';

const PRODUCT = {
  slug: SLUG,
  title: 'DigitalChiselCo Laser Studio',
  price_usd: 40,
  image_url: 'https://digitalchiselco.com/laser-studio/app-v26.webp',
  image_alt: 'Laser Studio on the CNC Match tab, a design locked onto a carved relief photographed on a laser bed',
  is_bundle: false,
  is_subscription: false,
  is_customizable: false,
  // Software in a Shopping feed built for STL files is a different category
  // with different rules. Held out until that is decided on purpose.
  google_feed_excluded: true,
  seo_title: 'Laser Studio: Photo and STL to Laser File Software for Windows',
  seo_description: 'Windows desktop software that turns photos and 3D models into ready-to-burn laser files. 50 looks, CNC Match for burning onto carvings, star maps, coasters and calibration tools. One-time purchase, free updates.',
  description: [
    '<p>Laser Studio turns a photo or a 3D model into ready-to-burn laser files, on your own Windows PC.</p>',
    '<ul>',
    '<li><strong>CNC Match:</strong> photograph a piece you carved, and burn text, shading or the same picture exactly onto it. Alignment is typically within about a millimetre.</li>',
    '<li><strong>50 looks</strong> from one photo: engraving, 3D illusion, 17 art engines and 31 signature styles.</li>',
    '<li><strong>Star maps, coasters, tumbler wraps</strong> and a seller kit with job cards, client proofs and quotes.</li>',
    '<li><strong>Calibration tools</strong> so you find your own power, speed and focus.</li>',
    '</ul>',
    '<p><strong>Windows 10 or 11, 64-bit only.</strong> There is no Mac or Linux version. It prepares files; you burn them with LightBurn, xTool, LaserGRBL or similar. It does not control your laser.</p>',
    '<p>One-time purchase. Free updates. Your photos are processed on your PC and never uploaded.</p>',
  ].join(''),
};

const DOWNLOAD = {
  file_name: 'DigitalChiselCo-LaserStudio-Setup.exe',
  drive_file_id: DRIVE_ID,
  download_link: `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`,
  size_bytes: 364 * 1024 * 1024,
  is_large: true,
  sort_order: 0,
};

const get = (q) => fetch(`${U}/rest/v1/${q}`, { headers: H }).then((r) => r.json());

const existing = (await get(`products?select=id,active,price_usd&slug=eq.${SLUG}`))?.[0];
console.log(existing ? `product exists (${existing.id}), active=${existing.active}` : 'product does not exist yet');

if (!APPLY) {
  console.log('\nDRY RUN. Would', existing ? 'update' : 'create', 'it', ACTIVATE ? 'and ACTIVATE it' : 'INACTIVE', `at $${PRODUCT.price_usd}`);
  process.exit(0);
}

let id = existing?.id;
if (!id) {
  const r = await fetch(`${U}/rest/v1/products`, {
    method: 'POST', headers: { ...H, prefer: 'return=representation' },
    body: JSON.stringify({ ...PRODUCT, active: ACTIVATE }),
  });
  const j = await r.json();
  if (!r.ok) { console.error('create failed', JSON.stringify(j).slice(0, 300)); process.exit(1); }
  id = j[0].id;
  console.log('created product', id);
} else {
  const r = await fetch(`${U}/rest/v1/products?id=eq.${id}`, {
    method: 'PATCH', headers: { ...H, prefer: 'return=minimal' },
    body: JSON.stringify({ ...PRODUCT, ...(ACTIVATE ? { active: true } : {}) }),
  });
  if (!r.ok) { console.error('update failed', (await r.text()).slice(0, 300)); process.exit(1); }
  console.log('updated product', id, ACTIVATE ? '(ACTIVATED)' : '');
}

const dl = await get(`product_downloads?select=id&product_id=eq.${id}`);
if (!dl?.length) {
  const r = await fetch(`${U}/rest/v1/product_downloads`, {
    method: 'POST', headers: { ...H, prefer: 'return=minimal' },
    body: JSON.stringify({ ...DOWNLOAD, product_id: id }),
  });
  console.log(r.ok ? 'download row created' : `download row FAILED ${(await r.text()).slice(0, 200)}`);
} else {
  console.log('download row already present');
}
