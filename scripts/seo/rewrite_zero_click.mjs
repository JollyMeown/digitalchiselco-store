// Rewrite the meta titles + descriptions of pages that ALREADY RANK in Google
// but earn no clicks (2026-09-08 analysis: 32 pages, ~850 impressions, near 0%
// CTR while sitting at position 2 to 25).
//
// Why these rewrites: the old titles all ended "| DigitalChiselCo", which
// Google now renders separately as the site name, so ~17 characters were spent
// on nothing. None of them answered the searcher's actual question, which for a
// digital file is "what machine does it work on and can I have it now". Every
// new title leads with the subject the person searched for (the shop's own
// Etsy data proves subject-first wins), then names the machines, and every
// description promises the instant download and the commercial licence.
//
//   node scripts/seo/rewrite_zero_click.mjs            # dry run, prints before/after
//   node scripts/seo/rewrite_zero_click.mjs --apply    # products -> PROPOSALS
//                                                      # blog + collections -> live
// Products are written as proposals (seo_status='generated'), so they appear in
// Admin > SEO for approval exactly like every other SEO change. Blog posts and
// collections have no proposal column; their previous values are saved to
// scripts/seo/.zero_click_backup.json so any of it can be put back.
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BACKUP = new URL('./.zero_click_backup.json', import.meta.url);

// ── PRODUCTS ────────────────────────────────────────────────────────────
// key = slug prefix (the GSC path is truncated, so match on the start)
const PRODUCTS = [
  { slug: 'anchor-with-rope-3d-relief-stl-file-nautical-maritime-wood',
    why: 'ranks 4.1 for "anchor stl" and 1.5 for "ship anchor stl", 50 impressions, zero clicks',
    title: 'Anchor and Rope Relief STL for CNC Router and 3D Print',
    desc: 'A ship anchor wrapped in rope, modelled as a deep bas-relief STL. Carve it on a CNC router, laser or 3D printer. Instant download, commercial use included.' },
  { slug: 'archangel-vs-demon-3d-relief-stl-file-saint-michael',
    why: 'ranks 4.7, zero clicks',
    title: 'Saint Michael Defeating the Devil Relief STL for CNC',
    desc: 'Archangel Michael standing over the demon, a dramatic Christian bas-relief STL for CNC routers and 3D printers. Instant download, commercial use included.' },
  { slug: 'australian-shepherd-dog-bas-relief-stl',
    why: 'ranks 2.5 for "australian shepherd stl", zero clicks',
    title: 'Australian Shepherd Relief STL for CNC and 3D Printing',
    desc: 'An Australian Shepherd peeking through pine branches, carved as a lifelike bas-relief STL. Ready for CNC routers, lasers and 3D printers. Instant download.' },
  { slug: 'autumn-harvest-pumpkin-bloom-cnc-relief-stl-thanksgiving',
    why: 'ranks 9.8, zero clicks, seasonal',
    title: 'Thanksgiving Pumpkin Relief STL for CNC Wood Carving',
    desc: 'An autumn harvest pumpkin and bloom bas-relief STL, cut ready for Thanksgiving signs and wall art. CNC router, laser or 3D printer. Instant download.' },
  { slug: 'cardinal-bird-serving-tray-stl-file-for-cnc-router',
    why: 'ranks 18.3 with no meta title at all',
    title: 'Cardinal Bird Serving Tray STL for CNC Routers',
    desc: 'A cardinal on a branch carved into a wooden serving tray, supplied as a CNC ready STL. Perfect gift project for bird lovers. Instant download, commercial use.' },
  { slug: 'carp-fish-relief-stl-cnc-router-3d-carving-model',
    why: 'ranks 18.7, and the old title said Arowana while the page is a koi carp',
    title: 'Koi Carp Fish Relief STL for CNC Router Carving',
    desc: 'A koi carp gliding through water, modelled as a flowing bas-relief STL for CNC routers and 3D printers. Instant download, commercial use included.' },
  { slug: 'christian-landscape-cnc-stl-relief',
    why: 'ranks 5.3, zero clicks',
    title: 'Stairway to Heaven Christian Relief STL for CNC',
    desc: 'A stairway rising through clouds, carved as a Christian landscape bas-relief STL. Ready for CNC routers, lasers and 3D printers. Instant download.' },
  { slug: 'hanging-bunny-stl-cute-rabbit-relief-easter-wall-decor',
    why: 'ranks 2.4, zero clicks',
    title: 'Hanging Bunny Relief STL for Easter Wall Decor',
    desc: 'A cute rabbit hanging by its paws, carved as a bas-relief STL for Easter signs and nursery decor. CNC router, laser or 3D print. Instant download.' },
  { slug: 'harvest-hand-wheat-bundle-cnc-router-stl-carving-rustic',
    why: 'ranks 5.1 with no meta title at all',
    title: 'Wheat Bundle Harvest Relief STL for CNC Carving',
    desc: 'A hand gathering a bundle of wheat, carved as a rustic farmhouse bas-relief STL. Ready for CNC routers and 3D printers. Instant download, commercial use.' },
  { slug: 'highland-cow-3d-relief-stl-longhorn-hairy-cow-mountain',
    why: 'ranks 15.3, sells 7 a year on Etsy',
    title: 'Highland Cow Relief STL for CNC and 3D Printing',
    desc: 'A shaggy Highland cow against a mountain landscape, carved as a bas-relief STL. Farmhouse wall art for CNC routers and 3D printers. Instant download.' },
  { slug: 'jesus-reaching-hand-relief-stl-jesus-says-hold-my-hand',
    why: 'ranks 2.4, zero clicks, sells 7 a year on Etsy',
    title: 'Jesus Reaching Hand Relief STL for CNC Wood Carving',
    desc: 'The hand of Jesus reaching down to yours, carved as a Christian bas-relief STL. Ready for CNC routers, lasers and 3D printers. Instant download.' },
  { slug: 'lion-of-judah-jesus-stl-crown-of-thorns-christian-wood',
    why: 'ranks 4.8, zero clicks',
    title: 'Lion of Judah and Jesus Relief STL, Crown of Thorns',
    desc: 'The face of Christ split with the Lion of Judah beneath a crown of thorns, carved as a Christian bas-relief STL for CNC routers. Instant download.' },
  { slug: 'orca-whale-3d-relief-stl-killer-whale-ocean-cnc-router',
    why: 'ranks 14.4, zero clicks',
    title: 'Orca Killer Whale Relief STL for CNC Router Carving',
    desc: 'An orca breaking through ocean swell, carved as a coastal bas-relief STL. Ready for CNC routers, lasers and 3D printers. Instant download, commercial use.' },
  { slug: 'pirate-skull-bas-relief-stl',
    why: 'ranks 10.8, zero clicks',
    title: 'Pirate Skull and Cutlass Relief STL for CNC Carving',
    desc: 'A bandana pirate skull over crossed cutlasses in a rope frame, carved as a bas-relief STL. CNC router, laser or 3D printer. Instant download.' },
  { slug: 'rose-3d-relief-stl-round-floral-cnc-router-wood-carving',
    why: 'ranks 5.9, sells 8 a year on Etsy',
    title: 'Rose Oval Plaque Relief STL for CNC Wood Carving',
    desc: 'A blooming rose on an oval plaque, carved as a floral bas-relief STL. Ready for CNC routers, lasers and 3D printers. Instant download, commercial use.' },
  { slug: 'skull-v8-engine-relief-stl-cnc-router',
    why: 'ranks 17.5, zero clicks',
    title: 'Skull and V8 Engine Relief STL for CNC Routers',
    desc: 'A skull built into a V8 engine with pistons and crankshaft, carved as a bas-relief STL for garage and biker wall art. CNC ready, instant download.' },
];

// ── BLOG POSTS ──────────────────────────────────────────────────────────
// The comparison guide alone is 12% of every impression the site earns.
const POSTS = [
  { slug: 'aspire-vcarve-carveco-fusion-360-comparison',
    why: '276 impressions, 3 clicks, position 9.6; ranks 12.3 for "vcarve vs aspire". The old title front-loaded four brand names before the answer.',
    title: 'VCarve vs Aspire: Which One Do You Actually Need in 2026?',
    desc: 'A carver\'s honest comparison of VCarve Pro and Aspire, plus Carveco and Fusion 360: what each costs, which does true 3D relief, and when the upgrade is worth it.' },
  { slug: 'stl-files-for-laser-engraving-guide',
    why: '77 impressions, 1 click, position 6.9',
    title: 'How to Laser Engrave an STL File (Depth Maps and Settings)',
    desc: 'Turn a bas-relief STL into a grayscale depth map your laser can burn, with the diode and CO2 settings, material choices and test grid that actually work.' },
  { slug: 'tapered-ball-nose-bits-relief-carving',
    why: '13 impressions, 0 clicks, position 16.0',
    title: 'Which Tapered Ball Nose Bit for Relief Carving? Tip Size Guide',
    desc: 'Choosing between 1/16, 1/32, 1 mm and 0.5 mm tapered ball nose tips: the stepover, feeds and finish each one gives on a 3D relief, with real cut times.' },
  { slug: 'cnc-relief-carving-time',
    why: '9 impressions, 0 clicks, position 9.8',
    title: 'Why Does CNC Relief Carving Take So Long? (And How to Halve It)',
    desc: 'A 3D relief can take a full day on a CNC router. Here is where the hours actually go, and the roughing, stepover and bit changes that cut the time by up to 80%.' },
];

// ── COLLECTIONS ─────────────────────────────────────────────────────────
// Every one of these ends "| DigitalChiselCo" and reads like a keyword list.
const COLLECTIONS = [
  { slug: 'fish-fly-fishing-stl',
    why: '75 impressions, 1 click, position 16.6',
    title: 'Fish and Fly Fishing Relief STL Files for CNC Carving',
    desc: 'Bass, trout, pike, marlin and fly fishing scenes as carve ready bas-relief STL files. Instant download for CNC routers, lasers and 3D printers.' },
  { slug: 'flying-ducks-owl-birds',
    why: '35 impressions, 1 click, position 22.1',
    title: 'Bird Relief STL Files: Ducks, Owls, Cardinals and Eagles',
    desc: 'Flying ducks, owls, cardinals and hummingbirds carved as bas-relief STL files. Instant download for CNC routers, lasers and 3D printers.' },
  { slug: 'cowboy-western',
    why: '23 impressions, 0 clicks, ranks 13.0 for "cowboy stl"',
    title: 'Cowboy and Western Relief STL Files for CNC Carving',
    desc: 'Horses, rodeo riders, ranch scenes and western portraits as carve ready bas-relief STL files. Instant download, commercial use included.' },
  { slug: 'coastal-nautical',
    why: '16 impressions, 0 clicks, position 19.1',
    title: 'Nautical Relief STL Files: Anchors, Lighthouses, Sea Life',
    desc: 'Anchors, lighthouses, sea turtles and ships carved as coastal bas-relief STL files. Instant download for CNC routers, lasers and 3D printers.' },
  { slug: 'wildlife-wall-art-stl',
    why: '15 impressions, 0 clicks, position 20.7',
    title: 'Wildlife Relief STL Files: Deer, Elk, Bear and Wolf',
    desc: 'Deer, elk, bear, wolf and mountain wildlife scenes as carve ready bas-relief STL files. Instant download for CNC routers and 3D printers.' },
  { slug: 'bald-eagle-patriotic',
    why: 'ranks 22.0 for "bald eagle stl", 10 impressions, 0 clicks',
    title: 'Bald Eagle and Patriotic Relief STL Files for CNC',
    desc: 'Bald eagles, flags, military tributes and veteran memorials carved as bas-relief STL files. Instant download for CNC routers and 3D printers.' },
  { slug: 'funny-animal-series',
    why: '10 impressions, 0 clicks, position 21.1',
    title: 'Funny Animal Relief STL Files for CNC Wood Carving',
    desc: 'Moose, donkeys, goats and cows with real character, carved as bas-relief STL files. Instant download for CNC routers, lasers and 3D printers.' },
];

const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…');
const backup = { at: new Date().toISOString(), posts: [], categories: [] };
let warned = 0;

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — zero-click meta rewrite\n`);

// products -> proposals
console.log('PRODUCTS (written as proposals for Admin > SEO approval)');
for (const p of PRODUCTS) {
  const { data: rows } = await db.from('products').select('id, slug, seo_title, seo_description').like('slug', `${p.slug}%`).limit(2);
  if (!rows?.length) { console.log(`  ✗ NOT FOUND ${p.slug}`); warned++; continue; }
  if (rows.length > 1) { console.log(`  ✗ AMBIGUOUS ${p.slug}`); warned++; continue; }
  const r = rows[0];
  console.log(`\n  ${r.slug.slice(0, 60)}`);
  console.log(`    why:    ${p.why}`);
  console.log(`    before: ${r.seo_title || '(no title)'}`);
  console.log(`    after:  ${p.title}  [${p.title.length} chars]`);
  if (p.desc.length > 158) { console.log(`    ! description ${p.desc.length} chars, will be truncated`); warned++; }
  if (APPLY) {
    const { error } = await db.from('products').update({
      proposed_seo_title: p.title, proposed_seo_description: p.desc,
      seo_status: 'generated', seo_generated_at: new Date().toISOString(),
    }).eq('id', r.id);
    if (error) { console.log(`    ! write failed: ${error.message}`); warned++; }
  }
}

// blog posts -> live (with backup)
console.log('\n\nBLOG POSTS');
for (const p of POSTS) {
  const { data: r } = await db.from('posts').select('id, slug, seo_title, seo_description').eq('slug', p.slug).maybeSingle();
  if (!r) { console.log(`  ✗ NOT FOUND ${p.slug}`); warned++; continue; }
  console.log(`\n  ${r.slug}`);
  console.log(`    why:    ${p.why}`);
  console.log(`    before: ${r.seo_title || '(none)'}`);
  console.log(`    after:  ${p.title}  [${p.title.length} chars]`);
  backup.posts.push({ slug: r.slug, seo_title: r.seo_title, seo_description: r.seo_description });
  if (APPLY) {
    const { error } = await db.from('posts').update({ seo_title: p.title, seo_description: p.desc }).eq('id', r.id);
    if (error) { console.log(`    ! write failed: ${error.message}`); warned++; }
  }
}

// collections -> live (with backup)
console.log('\n\nCOLLECTIONS');
for (const c of COLLECTIONS) {
  const { data: r } = await db.from('categories').select('id, slug, seo_title, seo_description').eq('slug', c.slug).maybeSingle();
  if (!r) { console.log(`  ✗ NOT FOUND ${c.slug}`); warned++; continue; }
  console.log(`\n  ${r.slug}`);
  console.log(`    why:    ${c.why}`);
  console.log(`    before: ${clip(r.seo_title || '(none)', 78)}`);
  console.log(`    after:  ${c.title}  [${c.title.length} chars]`);
  backup.categories.push({ slug: r.slug, seo_title: r.seo_title, seo_description: r.seo_description });
  if (APPLY) {
    const { error } = await db.from('categories').update({ seo_title: c.title, seo_description: c.desc }).eq('id', r.id);
    if (error) { console.log(`    ! write failed: ${error.message}`); warned++; }
  }
}

if (APPLY) {
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 1));
  console.log(`\n\nPrevious blog + collection values saved to ${BACKUP.pathname.replace(/^\//, '')}`);
  console.log(`Products are PROPOSALS: open Admin > SEO, tab "Generated", review and Approve.`);
} else {
  console.log('\n\nDry run only. Re-run with --apply to write.');
}
console.log(`\n${PRODUCTS.length} products, ${POSTS.length} posts, ${COLLECTIONS.length} collections${warned ? `, ${warned} warnings` : ', no warnings'}`);
