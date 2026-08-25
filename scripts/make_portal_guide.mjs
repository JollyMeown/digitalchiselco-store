// Build the branded "How your portal works" PDF that every buyer receives
// attached to their order-confirmation email, and upload it to Supabase
// Storage (downloads/portal-guide.pdf, stable URL — re-run to refresh).
//
// Usage:  node scripts/make_portal_guide.mjs [--shots <dir>] [--out <file>] [--no-upload]
//   --shots  directory containing portal-signin.png + portal-library.png
//            (default: scripts/assets/portal-shots)
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SHOTS = val('--shots', 'scripts/assets/portal-shots');
const OUT = val('--out', '.digest_send/portal-guide.pdf');
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));

const BRONZE = rgb(0.52, 0.31, 0.04);
const INK = rgb(0.15, 0.12, 0.09);
const SOFT = rgb(0.42, 0.38, 0.33);
const CREAM = rgb(0.985, 0.972, 0.945);

const W = 595.28, H = 841.89; // A4
const M = 54;

const doc = await PDFDocument.create();
doc.setTitle('How Your DigitalChiselCo Portal Works');
doc.setAuthor('DigitalChiselCo');
const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
const body = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

// logo (best-effort)
let logoImg = null;
try {
  const r = await fetch('https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/site-media/brand/1782452499676-lgzcu7.png');
  if (r.ok) logoImg = await doc.embedPng(Buffer.from(await r.arrayBuffer()));
} catch {}

function wrap(font, text, size, maxW) {
  const words = text.split(' ');
  const lines = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function para(page, font, text, size, x, y, maxW, color = INK, lh = 1.45) {
  for (const l of wrap(font, text, size, maxW)) { page.drawText(l, { x, y, size, font, color }); y -= size * lh; }
  return y;
}
function footer(page, n) {
  page.drawText('DigitalChiselCo  ·  digitalchiselco.com  ·  jolly@digitalchiselco.com', { x: M, y: 30, size: 8.5, font: body, color: SOFT });
  page.drawText(String(n), { x: W - M - 8, y: 30, size: 8.5, font: body, color: SOFT });
}

// ── Page 1: cover + benefits ─────────────────────────────────────────
{
  const p = doc.addPage([W, H]);
  p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: CREAM });
  p.drawRectangle({ x: 0, y: H - 130, width: W, height: 130, color: BRONZE });
  if (logoImg) { const s = 64 / logoImg.height; p.drawImage(logoImg, { x: M, y: H - 98, width: logoImg.width * s, height: 64 }); }
  p.drawText('DigitalChiselCo', { x: M + (logoImg ? 78 : 0), y: H - 72, size: 24, font: serif, color: rgb(1, 1, 1) });
  p.drawText('Premium STL files for CNC, laser and 3D printing', { x: M + (logoImg ? 78 : 0), y: H - 92, size: 10.5, font: body, color: rgb(0.98, 0.94, 0.86) });

  let y = H - 190;
  p.drawText('How Your Portal Works', { x: M, y, size: 30, font: serif, color: BRONZE }); y -= 26;
  y = para(p, body, 'Thank you for your purchase! Every order comes with lifetime access to your own customer portal. This one-page guide shows you how to sign in and what you get.', 11.5, M, y, W - 2 * M, INK); y -= 18;

  p.drawText('What your portal gives you', { x: M, y, size: 15, font: bold, color: INK }); y -= 22;
  const benefits = [
    ['Lifetime re-downloads', 'Every file you have ever bought stays available forever. Lost a file? Sign in and download it again, free.'],
    ['All your orders in one place', 'Full order history with each design, price, and a one-click download button per file.'],
    ['Loyalty points', 'You earn 10 points for every $1 you spend. Points convert into store credit codes you can spend on any design.'],
    ['Give 15%, get 15%', 'Your personal referral link gives friends 15% off their first order, and you receive a 15% reward code when they buy.'],
    ['Membership packs', 'If you join the membership, your monthly design packs appear in the portal too.'],
    ['No password to remember', 'Sign-in works by secure email link. There is nothing to forget and nothing to leak.'],
  ];
  for (const [t, d] of benefits) {
    p.drawCircle({ x: M + 4, y: y + 4, size: 3, color: BRONZE });
    p.drawText(t, { x: M + 16, y, size: 11.5, font: bold, color: INK }); y -= 15;
    y = para(p, body, d, 10.5, M + 16, y, W - 2 * M - 16, SOFT); y -= 9;
  }
  y -= 6;
  p.drawRectangle({ x: M, y: y - 44, width: W - 2 * M, height: 54, color: rgb(1, 1, 1), borderColor: BRONZE, borderWidth: 1, opacity: 1 });
  p.drawText('Your portal address:', { x: M + 14, y: y - 12, size: 10.5, font: body, color: SOFT });
  p.drawText('https://digitalchiselco.com/account', { x: M + 14, y: y - 30, size: 14, font: bold, color: BRONZE });
  footer(p, 1);
}

// ── Page 2: step-by-step sign in ─────────────────────────────────────
{
  const p = doc.addPage([W, H]);
  let y = H - 70;
  p.drawText('Signing in, step by step', { x: M, y, size: 22, font: serif, color: BRONZE }); y -= 30;

  p.drawText('Step 1 · Click "Account" in the top menu', { x: M, y, size: 13, font: bold, color: INK }); y -= 18;
  y = para(p, body, 'On any page of digitalchiselco.com, look at the menu bar at the top. Click the "Account" link (highlighted in red below). On a phone, tap the menu icon first, then Account. You land on the page shown here: type the SAME email address you used at checkout and press "Email me a sign-in link".', 10.5, M, y, W - 2 * M, SOFT); y -= 8;
  const shot1 = await doc.embedPng(fs.readFileSync(path.join(SHOTS, 'portal-signin.png')));
  { const s = Math.min((W - 2 * M) / shot1.width, 290 / shot1.height); const iw = shot1.width * s, ih = shot1.height * s; const x = (W - iw) / 2;
    // Red callout so buyers know exactly what to click: label sits ABOVE the
    // screenshot (never over page content) with an arrow down to a ring around
    // the "Account" link (fractions measured on the 1280x900 capture:
    // rect 1001,45 69x38 px).
    const RED = rgb(0.85, 0.1, 0.1);
    const label = 'Click "Account" to open your portal';
    const lw = bold.widthOfTextAtSize(label, 11);
    const imgTop = y - 20;                        // reserve a line for the label
    const hx = x + (1001 / 1280) * iw, hw = (69 / 1280) * iw;
    const hTop = imgTop - (45 / 900) * ih, hh = (38 / 900) * ih;
    p.drawText(label, { x: hx + hw - lw - 40, y: y - 8, size: 11, font: bold, color: RED });
    p.drawImage(shot1, { x, y: imgTop - ih, width: iw, height: ih });
    p.drawRectangle({ x, y: imgTop - ih, width: iw, height: ih, borderColor: BRONZE, borderWidth: 1 });
    p.drawRectangle({ x: hx, y: hTop - hh, width: hw, height: hh, borderColor: RED, borderWidth: 2, opacity: 0 });
    // short arrow from the label down-right onto the ring
    const ax = hx + hw / 2, ay = hTop + 2;        // tip just above the ring
    p.drawLine({ start: { x: hx + hw - 36, y: y - 10 }, end: { x: ax, y: ay }, thickness: 1.6, color: RED });
    p.drawLine({ start: { x: ax, y: ay }, end: { x: ax - 8, y: ay + 6 }, thickness: 1.6, color: RED });
    p.drawLine({ start: { x: ax, y: ay }, end: { x: ax + 2, y: ay + 10 }, thickness: 1.6, color: RED });
    y = imgTop - ih - 26; }

  p.drawText('Step 2 · Click the link in your inbox', { x: M, y, size: 13, font: bold, color: INK }); y -= 18;
  y = para(p, body, 'Within a minute you will receive an email titled "Sign in to your DigitalChiselCo account". Click the "View my account" button inside it. The link signs you in instantly and stays valid for 30 days. If you do not see the email, check your Spam or Promotions folder.', 10.5, M, y, W - 2 * M, SOFT); y -= 14;

  p.drawText('Step 3 · You are in!', { x: M, y, size: 13, font: bold, color: INK }); y -= 18;
  y = para(p, body, 'Your portal opens with every order you have ever placed, a download button for each file, your loyalty points, and your personal referral link. The next page shows what it looks like.', 10.5, M, y, W - 2 * M, SOFT);
  footer(p, 2);
}

// ── Page 3: the library, annotated ───────────────────────────────────
{
  const p = doc.addPage([W, H]);
  let y = H - 70;
  p.drawText('Inside your portal', { x: M, y, size: 22, font: serif, color: BRONZE }); y -= 26;
  const shot2 = await doc.embedPng(fs.readFileSync(path.join(SHOTS, 'portal-library.png')));
  { const s = Math.min((W - 2 * M) / shot2.width, 430 / shot2.height); const iw = shot2.width * s, ih = shot2.height * s; const x = (W - iw) / 2;
    p.drawImage(shot2, { x, y: y - ih, width: iw, height: ih });
    p.drawRectangle({ x, y: y - ih, width: iw, height: ih, borderColor: BRONZE, borderWidth: 1 });
    y -= ih + 22; }
  const notes = [
    ['Your points', 'Earn 10 points per $1. When you have enough, redeem them for a store-credit code right on this page.'],
    ['Give 15%, get 15%', 'Copy your personal link and share it. Friends save 15%, and you earn a 15% reward code on their first purchase.'],
    ['Download buttons', 'Each design in each order has its own download button. They never expire, come back any time.'],
  ];
  for (const [t, d] of notes) {
    p.drawCircle({ x: M + 4, y: y + 4, size: 3, color: BRONZE });
    p.drawText(t, { x: M + 16, y, size: 11.5, font: bold, color: INK }); y -= 15;
    y = para(p, body, d, 10.5, M + 16, y, W - 2 * M - 16, SOFT); y -= 8;
  }
  y -= 4;
  y = para(p, body, 'Questions or anything missing from your order? Just reply to your order email or write to jolly@digitalchiselco.com and I will sort it out personally.', 10.5, M, y, W - 2 * M, INK); y -= 6;
  p.drawText('Happy carving!', { x: M, y, size: 11.5, font: bold, color: BRONZE }); y -= 16;
  p.drawText('Jolly · DigitalChiselCo', { x: M, y, size: 10.5, font: body, color: SOFT });
  footer(p, 3);
}

const bytes = await doc.save();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, bytes);
console.log('wrote', OUT, (bytes.length / 1024).toFixed(0) + ' KB');

if (!argv.includes('--no-upload')) {
  const db = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await db.storage.from('downloads').upload('portal-guide.pdf', bytes, { contentType: 'application/pdf', upsert: true });
  if (error) { console.error('upload failed:', error.message); process.exit(1); }
  console.log('uploaded →', env.PUBLIC_SUPABASE_URL + '/storage/v1/object/public/downloads/portal-guide.pdf');
}
