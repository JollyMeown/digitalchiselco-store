// The in-article Laser Studio poster, rebuilt for v2.8.
//
// The July poster in the laser guide had its claims burned into the image:
// "11 output styles", "star maps, sundials, tumblers, boxes" and "100%
// offline". Sundials are hidden in the customer build, the count is 50, and
// the app does reach out for its update check and the upscaler model. Fixing
// the alt text alone would have left the picture saying it.
//
// Rebuilt on the CNC Match product photograph, same layout: eyebrow, title,
// tagline, four bullets, footer bar. Every line is something the app does.
// Uploaded under a NEW name so the old file is left untouched and the change
// is reversible by pointing the post back.
//
//   node scripts/make_laser_poster.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BG = path.join(ROOT, 'public', 'laser-studio', 'cnc-burned-panel.webp');
const OUT = path.join(ROOT, '.mockups', 'laser-studio', 'poster-v28.jpg');
const S = 1200;

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const BULLETS = [
  '50 looks from one photo',
  'CNC Match: burn onto what you carved',
  'Star maps, coasters, tumbler wraps',
  'One-time purchase, free updates',
];

const svg = `
<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a110a" stop-opacity="0"/>
      <stop offset="0.38" stop-color="#1a110a" stop-opacity="0.15"/>
      <stop offset="0.62" stop-color="#1a110a" stop-opacity="0.82"/>
      <stop offset="1" stop-color="#1a110a" stop-opacity="0.96"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#g)"/>
  <rect x="56" y="72" width="44" height="3" fill="#C8923E"/>
  <text x="112" y="80" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="4" fill="#E9C98E">ONE APP · EVERY LASER</text>

  <text x="56" y="640" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="104" fill="#FFFDF8">Laser Studio</text>
  <rect x="56" y="664" width="250" height="6" fill="#C8923E"/>

  <text x="56" y="726" font-family="Georgia, serif" font-style="italic" font-size="34" fill="#F4E6CF">Photos, 3D models and the night sky, turned into</text>
  <text x="56" y="770" font-family="Georgia, serif" font-style="italic" font-size="34" fill="#F4E6CF">ready-to-burn laser files on YOUR machine.</text>

  ${BULLETS.map((b, i) => `
  <circle cx="72" cy="${836 + i * 52}" r="10" fill="#C8923E"/>
  <text x="98" y="${846 + i * 52}" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#FFFDF8">${esc(b)}</text>`).join('')}

  <rect x="0" y="${S - 96}" width="${S}" height="96" fill="#5A3708"/>
  <rect x="0" y="${S - 96}" width="${S}" height="3" fill="#C8923E"/>
  <text x="56" y="${S - 46}" font-family="Georgia, serif" font-weight="700" font-size="32" fill="#FFFDF8">LASER STUDIO</text>
  <text x="56" y="${S - 20}" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#E9C98E">by DigitalChiselCo</text>
  <text x="${S - 56}" y="${S - 38}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#E9C98E">www.digitalchiselco.com</text>
</svg>`;

// square crop of the landscape photo, biased toward the carving
const bg = await sharp(BG).resize(S, S, { fit: 'cover', position: 'centre' }).toBuffer();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await sharp(bg).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 86, mozjpeg: true }).toFile(OUT);
console.log('poster written:', OUT);
if (/—/.test(svg)) console.error('WARNING: em dash in poster copy');
