// Build a Netlify _redirects file mapping the 56 GSC-known 404 URLs
// (old /product/<prefix>-<slug>.html pattern) to current /product/<slug> pages.
//
// For each old URL:
//   1. Strip the leading numeric ID or "item-" prefix and the trailing .html
//   2. Use that as a search prefix into the products table
//   3. Take the best-matching active product
//   4. If no match -> /catalog as a safe fallback
//
// Output: public/_redirects (Netlify serves this verbatim at deploy time).

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Hard-coded from GSC export (digitalchiselco.com-Coverage-Drilldown-2026-06-26.zip → Table.csv)
const OLD_URLS = [
  '/product/4478625802-bass-fish-crab-3d-relief-stl-for-cnc-router-fishing-wood-carving-panel-lakepond-.html',
  '/product/4462236309-crucifixion-hands-nail-3d-relief-stl-jesus-cross-detail-cnc-router-wood-carving-.html',
  '/product/4462352648-eagle-wolf-3d-relief-stl-wildlife-cnc-router-wood-carving-panel-file-bald-eagle-.html',
  '/product/item-mallard-ducks-flock-3d-relief-stl-flying-ducks-wood-carving-marsh-wildlife-wall-.html',
  '/product/item-romantic-hands-3d-relief-stl-intimate-couple-hands-hold-cnc-carving-love-wall-ar.html',
  '/product/item-native-tribal-girl-3d-relief-stl-aspire-vcarve-pro-carveco-fusion-360-artcam-las.html',
  '/product/item-tribal-girl-dancing-3d-relief-stl-aspire-vcarve-pro-carveco-fusion-360-artcam-cu.html',
  '/product/item-custom-3d-bas-relief-portrait-personalized-stl-file-for-cnc-and-printing-custom-.html',
  '/product/item-custom-3d-bas-relief-portrait-personalized-stl-file-for-cnc-and-printing-aspire-.html',
  '/product/item-abstract-couple-kiss-3d-relief-stl-modern-lovers-cnc-carving-romantic-wall-art-p.html',
  '/product/item-flying-duck-3d-relief-stl-duck-splash-wood-grain-cnc-carving-marsh-wildlife-wall.html',
  '/product/item-mother-duck-and-ducklings-3d-relief-stl-floral-waterfowl-cnc-carving-farmhouse-w.html',
  '/product/item-mallard-ducks-3d-relief-stl-flying-duck-cnc-carving-wildlife-marsh-wall-art-pane.html',
  '/product/item-flying-duck-3d-relief-stl-file-waterfowl-wing-spread-panel-hunting-cabin-wall-ar.html',
  '/product/item-cute-tribal-girl-3d-relief-stl-aspire-vcarve-pro-carveco-fusion-360-artcam-nativ.html',
  '/product/item-cute-tribal-girl-3d-relief-stl-aspire-vcarve-pro-carveco-fusion-360-artcam-chibi.html',
  '/product/item-farmhouse-scene-3d-relief-stl-aspire-vcarve-pro-carveco-fusion-360-artcam-rustic.html',
  '/product/item-ram-sheep-3d-relief-stl-aspire-vcarve-pro-carveco-fusion-360-artcam-farm-animal-.html',
  '/product/item-ship-wheel-nautical-3d-stl-aspire-vcarve-pro-carveco-artcam-ocean-waves-wall-pan.html',
  '/product/item-sunset-lake-sailboat-3d-relief-stl-nature-scene-wood-cnc-carving-rustic-wall-art.html',
  '/product/item-crocodile-zipper-3d-relief-stl-aspire-vcarve-pro-carveco-fusion-360-artcam-3d-pr.html',
  '/product/item-elephant-family-3d-relief-stl-file-elephants-wood-cnc-carving-safari-wildlife-ar.html',
  '/product/item-flying-geese-3d-relief-stl-goose-flock-wood-cnc-carving-wildlife-lake-wall-art-p.html',
  '/product/item-hen-and-lamb-3d-relief-stl-rustic-wood-cnc-carving-farm-animal-wall-decor-aspire.html',
  '/product/item-tree-of-life-tortoise-3d-relief-stl-turtle-nature-scene-cnc-router-wood-carving-.html',
  '/product/item-squirrel-stl-3d-relief-chipmunksquirrel-holding-nut-wood-carving-cnc-file-woodla.html',
  '/product/4461804798-bald-eagle-stl-3d-relief-eagle-head-flying-eagle-cnc-carving-file-american-eagle.html',
  '/product/4442529232-bass-fishing-3d-relief-stl-file-fish-lure-wood-grain-cnc-carving-underwater-rive.html',
  '/product/4438439545-native-warrior-and-biker-3d-relief-stl-horse-motorcycle-western-tribute-panel-cn.html',
  '/product/4491056467-custom-3d-bas-relief-portrait-personalized-stl-file-for-cnc-printing-aspire-vcar.html',
  '/product/4464416364-fantasy-gnome-mouse-3d-relief-stl-gnome-with-lute-mouse-cnc-router-wood-carving-.html',
  '/product/4446993213-the-last-supper-3d-relief-stl-jesus-12-apostles-cnc-router-wood-carving-panel-ch.html',
  '/product/item-magnolia-flower-relief-stl-cnc-router-3d-carving-model-large-blossom-wood-grain-.html',
  '/product/item-tulip-bouquet-3d-relief-stl-for-cnc-router-floral-bunch-wood-carving-panel-sprin.html',
  '/product/item-eagle-skull-3d-relief-stl-gothic-cnc-carving-dark-art-wall-panel-predator-claw-s.html',
  '/product/item-brittany-spaniel-dog-love-stl-realistic-pet-carving-cabin-wall-art-decor-woodlan.html',
  '/product/item-biker-skull-3d-relief-stl-motorcycle-handlebar-cnc-router-wood-carving-file-goth.html',
  '/product/item-dont-look-back-skull-3d-relief-stl-for-cnc-router-horror-wall-sign-wood-carving-.html',
  '/product/item-crocus-flowers-relief-stl-cnc-router-3d-carving-model-spring-floral-wood-grain-b.html',
  '/product/item-wild-boar-3d-relief-stl-aspire-vcarve-pro-carveco-fusion-360-artcam-boar-head-fl.html',
  '/product/item-pitbull-stl-dog-love-relief-heart-paws-wall-decor-rustic-pet-artwork-wood-carvin.html',
  '/product/item-brittany-spaniel-dog-love-stl-spaniel-portrait-relief-pet-wall-decor-heart-paws-.html',
  '/product/item-vintage-airplane-3d-relief-stl-wwii-fighter-plane-cnc-carving-aviation-wall-art-.html',
  '/product/4437817482-cowboy-horse-3d-relief-stl-western-desert-water-scene-wall-panel-cnc-router-carv.html',
  '/product/4436602725-rainbow-bridge-pet-memorial-3d-relief-stl-dog-child-sympathy-wall-art-panel-cnc-.html',
  '/product/4461207018-bass-crawfish-relief-stl-cnc-router-3d-carving-file-fishing-scene-wood-grain-bas.html',
  '/product/item-fishing-scene-3d-relief-stl-fisherman-fish-wood-grain-cnc-carving-rustic-lake-wa.html',
  '/product/item-gloucester-fishermans-memorial-man-at-the-wheel-stl-gloucester-ma-monument-marit.html',
  '/product/item-carp-fish-stl-3d-relief-koicyprinus-wood-carving-cnc-file-fishing-wall-art-panel.html',
  '/product/item-largemouth-bass-3d-stl-fishing-relief-panel-big-bass-wall-art-fisherman-man-cave.html',
  '/product/item-1000-stl-files-cnc-mega-bundle-catalog-3d-relief-wood-carving-models-bas-relief-.html',
  '/product/item-squirrel-relief-stl-cnc-router-3d-carving-model-cute-squirrel-with-pine-cones-wo.html',
  '/product/item-teddy-bear-i-love-you-3d-relief-stl-cnc-router-wood-carving-file-valentine-nurse.html',
  '/product/item-windmill-tulip-field-3d-relief-stl-cnc-router-wood-carving-file-dutch-farmhouse-.html',
  '/product/item-shipwreck-underwater-3d-relief-stl-aspire-vcarve-pro-carveco-artcam-sunken-boat-.html',
  '/product/4448795602-buck-doe-deer-3d-relief-stl-whitetail-couple-wood-carving-cnc-file-rustic-wildli.html',
];

// Strip prefix and .html → reduce to a "search slug"
function cleanSlug(oldUrl) {
  let s = oldUrl.replace(/^\/product\//, '').replace(/\.html$/, '');
  // Strip leading numeric Etsy ID like "4478625802-"
  s = s.replace(/^\d{8,}-/, '');
  // Strip leading "item-"
  s = s.replace(/^item-/, '');
  // Strip trailing dashes (the truncated tail)
  s = s.replace(/-+$/, '');
  return s;
}

async function bestMatch(searchSlug) {
  // The old slug was truncated to a fixed length. Use the FIRST 4-5 keywords
  // (the most distinctive part) as the prefix match.
  const tokens = searchSlug.split('-');
  // Try progressively shorter prefixes until we get a match
  for (let len of [10, 8, 6, 5, 4, 3]) {
    if (len > tokens.length) continue;
    const prefix = tokens.slice(0, len).join('-');
    const { data } = await db
      .from('products')
      .select('slug, title')
      .eq('active', true)
      .ilike('slug', `${prefix}%`)
      .limit(1);
    if (data && data.length) return data[0];
  }
  return null;
}

const rules = [];
const unmatched = [];
let matchCount = 0;

for (const oldUrl of OLD_URLS) {
  const search = cleanSlug(oldUrl);
  const match = await bestMatch(search);
  if (match) {
    rules.push(`${oldUrl}    /product/${match.slug}    301`);
    matchCount++;
    console.log(`OK   ${oldUrl.slice(0, 70)}... -> /product/${match.slug.slice(0, 50)}`);
  } else {
    rules.push(`${oldUrl}    /catalog    301`);
    unmatched.push(oldUrl);
    console.log(`MISS ${oldUrl.slice(0, 70)}... -> /catalog`);
  }
}

const header = `# Netlify _redirects — generated by scripts/build_redirects.mjs
# Maps GSC-known legacy 404 URLs to closest current product (or /catalog fallback).
# Format: <from>  <to>  <status>
# 301 = permanent redirect; transfers SEO ranking signal from old URL to new.

`;
const body = rules.join('\n') + '\n';

// Append legacy pattern-catch as a final safety net (anything new with .html suffix → /catalog)
const patternCatch = `
# Pattern catch — any old /product/...html that wasn't matched above
/product/*.html    /catalog    301
`;

writeFileSync('public/_redirects', header + body + patternCatch);

console.log('\n=== Summary ===');
console.log(`  Matched specific products: ${matchCount} / ${OLD_URLS.length}`);
console.log(`  Fallback to /catalog:      ${unmatched.length}`);
console.log(`  Output: public/_redirects (${rules.length + 1} rules)`);
