// Turn each article's generated "pin" scene into a finished Pinterest poster:
// 1000x1500, the photograph full-bleed, a FREE GUIDE badge, the title and a
// one-line hook set as font paths over a dark gradient, and the site as the
// footer. Uploads to storage and writes posts.pin_image_url / pin_title /
// pin_description, which the Pinterest RSS feeds read.
//
//   node scripts/blog/compose_pins.mjs [slug ...]     (default: every article with .mockups/blog-<slug>/pin.jpg)
//
// Text is drawn as paths from the bundled Lora fonts (same as /pin/<slug>.jpg)
// so the result is identical wherever it is rendered.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import opentype from 'opentype.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const URL_BASE = cfg('PUBLIC_SUPABASE_URL');
const SERVICE = cfg('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SERVICE, authorization: `Bearer ${SERVICE}` };
const BUCKET = 'site-media';
const W = 1000, HH = 1500, MAX_TEXT_W = 860;
const CREAM = '#FAEEDA', GOLD = '#FAC775', BRONZE = '#854F0B';

// Pin copy per article: a title Pinterest can search (under 100 chars) and a
// description with the phrases people type, ending in the site. No em dashes.
const PINS = {
  'first-cnc-relief-carving-step-by-step': {
    hook: 'File, board, cutters, toolpaths, finish',
    title: 'Your First CNC Relief Carving, Step by Step (Free Guide)',
    desc: 'A complete beginner walkthrough for carving a 3D relief STL on a CNC router: choosing a forgiving file, the board, three cutters, CAM setup, the test tile, roughing and finishing passes, sanding and glazing. Free guide from DigitalChiselCo, makers of bas-relief STL files for CNC, laser and 3D printing. #cncrouter #reliefcarving #woodcarving #cncprojects #stlfiles #beginnercnc',
  },
  'selling-cnc-relief-carvings': {
    hook: 'The pricing formula and what actually sells',
    title: 'How to Price and Sell CNC Relief Carvings (Formula + What Sells)',
    desc: 'The pricing formula that holds up, worked examples with real numbers, a live price calculator, which relief subjects sell at markets and online, photographing a carving, packaging, and what the file licence allows. Free guide from DigitalChiselCo. #cncbusiness #woodworkingbusiness #reliefcarving #cncrouter #craftfair #sellwoodwork',
  },
  '3d-printing-bas-relief-stl': {
    hook: 'Settings that keep the detail on FDM and resin',
    title: '3D Printing a Bas-Relief STL: Settings That Keep the Detail',
    desc: 'How to 3D print a relief STL without losing the fine detail: orientation, layer height, supports, resin versus FDM, scaling depth, priming and painting a printed relief so it looks carved. Free guide from DigitalChiselCo, bas-relief STL files for 3D printers, CNC and laser. #3dprinting #stlfiles #basrelief #resinprinting #fdmprinting #3dprintedart',
  },
  'cnc-relief-carving-looks-flat': {
    hook: 'The seven causes and the fix for each',
    title: 'Why Your CNC Relief Carving Looks Flat (7 Fixes)',
    desc: 'Depth scaled away, the wrong cutter, no glaze, flat lighting, a shallow file: the seven reasons a relief carving comes off the machine looking flat, and the fix for each. Before and after on the same design. Free guide from DigitalChiselCo. #cncrouter #reliefcarving #woodcarving #cnctips #vcarve #aspire',
  },
  'tapered-ball-nose-bits-relief-carving': {
    hook: 'Which tip, which taper, which stepover',
    title: 'Tapered Ball Nose Bits for Relief Carving: Which Tip and Stepover',
    desc: 'Choosing and using tapered ball nose cutters for 3D relief carving on a CNC router: tip size against detail, taper angle against depth, stepover for a clean scallop, feeds and speeds, and when a 1/32 inch tip is worth the time. Free guide from DigitalChiselCo. #cncbits #cncrouter #reliefcarving #tooling #woodcarving #cncmachining',
  },
  'best-wood-for-cnc-relief-carving': {
    hook: 'One design carved in eight woods',
    title: 'Best Wood for CNC Relief Carving: One Design in 8 Woods',
    desc: 'Cherry, walnut, maple, basswood, oak, poplar, sapele and pine, the same relief carved in each, with how they cut, how the detail holds, what the finish does, and which to buy for a first panel or a gift. Free guide from DigitalChiselCo. #woodcarving #cncrouter #reliefcarving #hardwood #woodworkingtips #cncprojects',
  },
  'cnc-relief-carving-time': {
    hook: 'Where the hours go and how to cut them',
    title: 'Why a Relief Carving Takes So Long, and How to Make It Faster',
    desc: 'Real carve times for relief panels on a CNC router, why roughing and finishing take what they take, stepover and feed choices that cut hours without losing detail, and a planning table by panel size. Free guide from DigitalChiselCo. #cncrouter #reliefcarving #cnctips #toolpaths #woodcarving #vcarve',
  },
  'carved-wood-gift-guide': {
    hook: 'What to carve for anglers, cabins, faith, pets',
    title: 'The Carved Wood Gift Guide: What to Carve for Everyone',
    desc: 'Relief carving gift ideas by person and occasion: anglers, hunters, cabin owners, dog people, faith, weddings and anniversaries, with sizes, woods and finishes for each, and how to wrap a carving. Free guide from DigitalChiselCo, bas-relief STL files for CNC routers. #woodgifts #handmadegifts #reliefcarving #cncprojects #giftideas #woodcarving',
  },
  'how-to-finish-cnc-relief-carvings': {
    hook: 'Sanding, sealing, glazing, oiling, waxing',
    title: 'How to Finish a CNC Relief Carving: The Complete Guide',
    desc: 'The finishing process that makes a relief carving look carved: sanding and brushing off fuzz, sealing, the dark glaze wiped back off the high points, oil and wax, food-safe finishes for trays, outdoor finishes, and a troubleshooting table. Free guide from DigitalChiselCo. #woodfinishing #reliefcarving #cncrouter #woodcarving #glaze #woodworkingtips',
  },
  'stl-files-for-laser-engraving-guide': {
    hook: 'Turn a relief file into a grayscale burn',
    title: 'STL Files for Laser Engraving: Relief to Grayscale, Step by Step',
    desc: 'How to turn a 3D relief STL into a laser engraving: exporting the depth map, grayscale settings, which materials show it best, diode versus CO2, and the Laser Studio app that does it in one click. Free guide from DigitalChiselCo. #laserengraving #lasercutting #stlfiles #diodelaser #co2laser #grayscaleengraving',
  },
  'what-makes-a-good-bas-relief-stl-file': {
    hook: 'Seven red flags before you buy',
    title: 'What Makes a Good Bas-Relief STL File (7 Red Flags)',
    desc: 'How to judge a relief STL before you carve or print it: depth, resolution, watertight mesh, clean edges, correct scale, and the seven red flags of a bad file. Our reliefs run 12 to 60 mm deep. Free guide from DigitalChiselCo. #stlfiles #basrelief #cncrouter #3dprinting #reliefcarving #cncfiles',
  },
  '10-beginner-cnc-bas-relief-projects': {
    hook: 'Carve this weekend, in difficulty order',
    title: '10 Beginner CNC Relief Carving Projects to Carve This Weekend',
    desc: 'Ten relief carving projects for a first CNC router, in difficulty order: hearts, leaves, feathers, small animals, signs and trays, with the cutter, wood, size and carve time for each. Free guide from DigitalChiselCo, bas-relief STL files for CNC. #cncprojects #beginnercnc #reliefcarving #cncrouter #woodcarving #weekendproject',
  },
  'aspire-vcarve-carveco-fusion-360-comparison': {
    hook: 'VCarve vs Aspire vs Carveco vs Fusion 360',
    title: 'VCarve vs Aspire vs Carveco vs Fusion 360 for Relief Carving (2026)',
    desc: 'Which CAM software to buy for carving 3D relief STL files: VCarve Pro against Aspire head to head, Carveco Maker, Fusion 360, Easel Pro and Carbide Create, with 2026 prices, STL import, toolpaths, bed limits and a plain recommendation. Free guide from DigitalChiselCo. #vcarve #aspire #carveco #fusion360 #cncsoftware #cncrouter',
  },
  'how-to-scale-stl-files-for-cnc-routers': {
    hook: 'Resize without ruining the detail',
    title: 'How to Scale STL Files for CNC Routers Without Losing Detail',
    desc: 'Scaling a relief STL up or down for your machine: the depth rule, when to scale Z separately, resolution limits, tiling a big panel, and how to do it in VCarve, Aspire, Carveco and Fusion 360. Free guide from DigitalChiselCo. #stlfiles #cncrouter #vcarve #aspire #reliefcarving #cnctips',
  },
};

const fonts = {
  reg: opentype.loadSync(path.join(ROOT, 'public', 'fonts', 'Lora-Regular.ttf')),
  bold: opentype.loadSync(path.join(ROOT, 'public', 'fonts', 'Lora-Bold.ttf')),
};
const width = (f, s, size, o = {}) => f.getAdvanceWidth(s, size, o);
const pathText = (f, s, x, y, size, fill, o = {}) => `<path d="${f.getPath(s, x, y, size, o).toPathData(2)}" fill="${fill}"/>`;
const centred = (f, s, y, size, fill, o = {}) => pathText(f, s, W / 2 - width(f, s, size, o) / 2, y, size, fill, o);
function wrap(f, s, size, maxLines, maxW = MAX_TEXT_W) {
  const words = s.split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (width(f, cur + ' ' + w, size) <= maxW) cur += ' ' + w; else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

async function upload(slug, buf) {
  const objectKey = `blog/${slug}/pin-poster.jpg`;
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${objectKey}`, { method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: buf });
  if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${objectKey}`;
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const slugs = wanted.length ? wanted : Object.keys(PINS);
let n = 0;
for (const slug of slugs) {
  const copy = PINS[slug];
  const src = path.join(ROOT, '.mockups', `blog-${slug}`, 'pin.jpg');
  if (!copy) { console.log('no pin copy for', slug); continue; }
  if (!fs.existsSync(src)) { console.log('no pin.jpg for', slug); continue; }
  for (const v of [copy.hook, copy.title, copy.desc]) if (v.includes('—')) throw new Error('em dash in ' + slug);

  const photo = await sharp(src).resize(W, HH, { fit: 'cover', position: 'attention' }).toBuffer();
  // Read time from the live article, for the top-right pill.
  let mins = 0;
  try {
    const pr = await fetch(`${URL_BASE}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&select=body`, { headers: H });
    const [p] = await pr.json();
    mins = Math.max(1, Math.round(String(p?.body || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length / 220));
  } catch {}

  // ── layout, bottom up ─────────────────────────────────────────────
  // eyebrow (gold, letter-spaced) / headline (cream, largest size that fits
  // three lines) / CTA button (bronze pill) / site line. Everything sits on a
  // deep gradient so it reads on any photograph, inside a hairline frame.
  let size = 74, lines = [];
  for (; size >= 48; size -= 4) { lines = wrap(fonts.bold, copy.title, size, 3, 840); if (lines.join(' ') === copy.title) break; }
  const lh = size * 1.08;
  const siteY = HH - 64;
  const btnH = 64, btnY = siteY - 44 - btnH;
  const titleBottom = btnY - 44;
  const titleTop = titleBottom - lines.length * lh;
  const eyebrowY = titleTop - 26;
  const gradTop = Math.max(HH * 0.36, eyebrowY - 300);
  const eyebrow = copy.hook.toUpperCase();
  const eyebrowSize = 22;
  const cta = 'READ THE FREE GUIDE';
  const ctaW = width(fonts.bold, cta, 24, { letterSpacing: 0.1 }) + 96;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HH}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#160c03" stop-opacity="0"/><stop offset="0.35" stop-color="#160c03" stop-opacity="0.62"/><stop offset="1" stop-color="#160c03" stop-opacity="0.96"/></linearGradient>
      <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#160c03" stop-opacity="0.55"/><stop offset="1" stop-color="#160c03" stop-opacity="0"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="220" fill="url(#t)"/>
    <rect x="0" y="${gradTop}" width="${W}" height="${HH - gradTop}" fill="url(#g)"/>
    <rect x="26" y="26" width="${W - 52}" height="${HH - 52}" rx="10" fill="none" stroke="${CREAM}" stroke-opacity="0.32" stroke-width="2"/>`;
  // top-left badge, top-right read time
  const badge = 'FREE GUIDE';
  const bw = width(fonts.bold, badge, 22, { letterSpacing: 0.14 }) + 44;
  svg += `<rect x="56" y="56" width="${bw}" height="48" rx="24" fill="${BRONZE}"/>` + pathText(fonts.bold, badge, 78, 88, 22, CREAM, { letterSpacing: 0.14 });
  if (mins) {
    const rt = `${mins} MIN READ`;
    const rw = width(fonts.bold, rt, 20, { letterSpacing: 0.12 }) + 40;
    svg += `<rect x="${W - 56 - rw}" y="56" width="${rw}" height="48" rx="24" fill="#160c03" fill-opacity="0.55" stroke="${CREAM}" stroke-opacity="0.5" stroke-width="1.5"/>` + pathText(fonts.bold, rt, W - 56 - rw + 20, 87, 20, CREAM, { letterSpacing: 0.12 });
  }
  // eyebrow with rules either side
  const ew = width(fonts.bold, eyebrow, eyebrowSize, { letterSpacing: 0.16 });
  const ex = W / 2 - ew / 2;
  svg += `<rect x="${Math.max(60, ex - 70)}" y="${eyebrowY - 8}" width="${Math.min(50, ex - 70 > 60 ? 50 : 0)}" height="2" fill="${GOLD}"/>`;
  svg += `<rect x="${ex + ew + 20}" y="${eyebrowY - 8}" width="${Math.min(50, W - 60 - (ex + ew + 20))}" height="2" fill="${GOLD}"/>`;
  svg += centred(fonts.bold, eyebrow, eyebrowY, eyebrowSize, GOLD, { letterSpacing: 0.16 });
  // headline
  lines.forEach((ln, i) => { svg += centred(fonts.bold, ln, titleTop + (i + 1) * lh - size * 0.2, size, CREAM); });
  // CTA button
  svg += `<rect x="${W / 2 - ctaW / 2}" y="${btnY}" width="${ctaW}" height="${btnH}" rx="32" fill="${BRONZE}"/>`;
  svg += `<rect x="${W / 2 - ctaW / 2}" y="${btnY}" width="${ctaW}" height="${btnH}" rx="32" fill="none" stroke="${GOLD}" stroke-opacity="0.55" stroke-width="1.5"/>`;
  svg += centred(fonts.bold, cta, btnY + 41, 24, CREAM, { letterSpacing: 0.1 });
  // site line
  svg += centred(fonts.reg, 'digitalchiselco.com', siteY, 24, '#e2d3b8');
  svg += '</svg>';
  const out = await sharp(photo).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const local = path.join(ROOT, '.mockups', `blog-${slug}`, 'pin-poster.jpg');
  fs.writeFileSync(local, out);
  const url = await upload(slug, out);
  const r = await fetch(`${URL_BASE}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH', headers: { ...H, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ pin_image_url: url + '?v=' + Date.now().toString(36), pin_title: copy.title.slice(0, 100), pin_description: copy.desc.slice(0, 500), pin_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`posts patch ${r.status}: ${(await r.text()).slice(0, 120)}`);
  console.log('poster:', slug, `(${lines.length} lines at ${size}px)`);
  n++;
}
console.log(n, 'posters built and uploaded');
