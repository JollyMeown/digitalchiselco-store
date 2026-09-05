// Give BRS-published website products their Etsy showcase video, SAFELY.
// A wrong video on a product is worse than no video, so nothing is written
// unless the evidence is strong:
//   Pass A, title: normalised titles equal (or the part before "|" equal and
//     the word sets overlap 70%+), unambiguous both ways, AND the pictures
//     agree: perceptual-hash distance <= 10 of 64 bits. 11..22 = ask the
//     cheapest Gemini vision model "same design?" and accept only on YES.
//   Pass B, picture first (BRS gives Etsy and the website different titles):
//     the product's main picture is compared with EVERY listing's first
//     picture; a clear nearest neighbour (distance <= 14 and at least 6 bits
//     ahead of the runner-up), not already used by another product, is then
//     confirmed by the same cheap Gemini check. Accept only on YES.
// Videos are Etsy CDN URLs: nothing is downloaded or stored on the site.
// Image hashes are cached in scripts/.etsy_img_hashes.json.
//
//   node scripts/etsy_link_videos.mjs --dry     # report only (do this first)
//   node scripts/etsy_link_videos.mjs           # link + fetch videos
import 'dotenv/config';
import fs from 'node:fs';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const DRY = process.argv.includes('--dry');
const HASH_OK = 10, HASH_ASK = 22, PIC_NEAR = 14, PIC_MARGIN = 6;
const SHOPS = [{ name: 'DigitalChiselCo', id: 61524055, oauth: true }, { name: 'CustomReliefCo', id: 67531832, oauth: false }];
const CACHE = new URL('./.etsy_img_hashes.json', import.meta.url);
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();
const head = (s) => norm(String(s || '').split('|')[0]);
const STOP = new Set(['stl', 'file', 'files', 'for', 'and', 'the', 'a', 'of', 'cnc', 'relief', 'bas', '3d', 'model', 'carving', 'wall', 'art', 'router', 'digital', 'download', 'wood', 'print', 'printing', 'laser']);
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let i = 0; for (const w of A) if (B.has(w)) i++; return i / (A.size + B.size - i); };
const short = (t) => String(t || '').split('|')[0].trim().slice(0, 46).padEnd(46);

// ── cheap Gemini vision second opinion (key from the BRS config, like etsy_rewrite_gemini.mjs) ──
// cheapest vision-capable models first; any "not available" answer moves to the next name
let GEMINI_KEY = '', GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3-flash-preview'];
try { const cfg = JSON.parse(fs.readFileSync('D:/000 BUNDLE RELIEF STUDIO/_config/config.json', 'utf8')); GEMINI_KEY = cfg.gemini_api_key || ''; if (cfg.gemini_cheap_model) GEMINI_MODELS.unshift(cfg.gemini_cheap_model); } catch { /* no key: borderline cases are simply rejected */ }
let geminiCalls = 0, geminiModel = '';
const imgCache = new Map();
async function fetchImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {           // flaky connections must never kill the run
    try {
      const res = await fetch(url); if (!res.ok) throw new Error(`image ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer()); imgCache.set(url, buf); return buf;
    } catch (e) { last = e; await sleep(800 * (attempt + 1)); }
  }
  throw last;
}
const small = async (u) => (await sharp(await fetchImage(u)).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
async function askGemini(parts, maxTokens = 5) {
  if (!GEMINI_KEY) return null;
  const models = geminiModel ? [geminiModel, ...GEMINI_MODELS.filter((m) => m !== geminiModel)] : GEMINI_MODELS;
  for (const model of models) {
    try {
      geminiCalls++;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0 } }),
      });
      const j = await r.json();
      if (j.error) { if (/not found|unsupported|not available|no longer|deprecated/i.test(j.error.message || '')) continue; throw new Error(j.error.message); }
      geminiModel = model;
      return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim().toUpperCase();
    } catch (e) { console.error('   gemini:', String(e.message).slice(0, 80)); return null; }
  }
  return null;
}
/** YES / NO / null for "same carved design?" */
async function sameDesign(urlA, urlB) {
  const text = await askGemini([
    { text: 'Picture 1 and picture 2: do they show the SAME carved relief design (same subject and same composition, even if the photo, colour, mockup frame or crop differs)? Reply with exactly one word: YES or NO.' },
    { inlineData: { mimeType: 'image/jpeg', data: await small(urlA) } }, { inlineData: { mimeType: 'image/jpeg', data: await small(urlB) } },
  ]);
  if (!text) return null;
  if (text.startsWith('YES')) return true;
  if (text.startsWith('NO')) return false;
  return null;
}
/** Which of the candidate pictures (1..n) shows the same design as picture 0? Returns index or null (NONE / unsure). */
async function pickSame(productUrl, candidateUrls) {
  const parts = [{ text: `Picture 0 is a carved relief design. Pictures 1 to ${candidateUrls.length} are candidates. Exactly which ONE candidate shows the SAME design as picture 0 (same subject and composition; ignore colour, mockup frame or crop)? Reply with only the number, or NONE if none of them is the same design.` },
    { text: 'Picture 0:' }, { inlineData: { mimeType: 'image/jpeg', data: await small(productUrl) } }];
  for (let i = 0; i < candidateUrls.length; i++) { parts.push({ text: `Picture ${i + 1}:` }); parts.push({ inlineData: { mimeType: 'image/jpeg', data: await small(candidateUrls[i]) } }); }
  const text = await askGemini(parts, 6);
  if (!text || /NONE/.test(text)) return null;
  const n = Number((text.match(/\d+/) || [])[0]);
  return n >= 1 && n <= candidateUrls.length ? n - 1 : null;
}

// ── perceptual hash (dHash, 64 bits) with a cache on disk ──
const hashes = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
let cacheDirty = false;
async function dhash(url) {
  if (hashes[url]) return hashes[url];
  const px = await sharp(await fetchImage(url)).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] < px[y * 9 + x + 1] ? '1' : '0';
  hashes[url] = bits; cacheDirty = true; return bits;
}
const dist = (a, b) => { let d = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) d++; return d; };
const saveCache = () => { if (cacheDirty) fs.writeFileSync(CACHE, JSON.stringify(hashes)); };

// ── 1. active listings of every shop, with first image + video ──
const listings = [];
for (const shop of SHOPS) {
  let offset = 0, total = Infinity;
  while (offset < total) {
    const page = shop.oauth
      ? await etsy(`/shops/${shop.id}/listings?state=active&limit=100&offset=${offset}&includes=Images,Videos`, { oauth: true })
      : await etsy(`/shops/${shop.id}/listings/active?limit=100&offset=${offset}`);
    total = page.count || 0;
    for (const l of page.results || []) {
      const img = (l.images || [])[0];
      const vid = (l.videos || []).find((v) => v.video_state === 'active') || (l.videos || [])[0];
      listings.push({ id: String(l.listing_id), title: l.title, shop: shop.name, image: img?.url_570xN || img?.url_fullxfull || null, video: vid ? { url: vid.video_url, thumb: vid.thumbnail_url } : (l.videos ? null : undefined) });
    }
    offset += 100;
    if (!shop.oauth) break;
    await sleep(150);
  }
  console.log(`${shop.name}: ${listings.filter((l) => l.shop === shop.name).length} active listings`);
}
for (const l of listings) {                       // anonymous listings: pictures + videos per listing
  if (l.image === null && l.video === undefined) {
    try { const im = await etsy(`/listings/${l.id}/images`); l.image = im.results?.[0]?.url_570xN || im.results?.[0]?.url_fullxfull || null; } catch { l.image = null; }
    try { const v = await etsy(`/listings/${l.id}/videos`); const vid = (v.results || []).find((x) => x.video_state === 'active') || (v.results || [])[0]; l.video = vid ? { url: vid.video_url, thumb: vid.thumbnail_url } : null; } catch { l.video = null; }
    await sleep(120);
  }
}
// hash every listing picture (cached after the first run)
let hashed = 0;
for (const l of listings) { if (!l.image) continue; try { l.hash = await dhash(l.image); hashed++; } catch { l.hash = null; } }
saveCache();
console.log(`listing pictures hashed: ${hashed}/${listings.length}`);

const { data: linkedRows } = await db.from('products').select('etsy_listing_id').not('etsy_listing_id', 'is', null).limit(5000);
const usedListing = new Set((linkedRows || []).map((r) => String(r.etsy_listing_id)));
const byNorm = new Map(), byHead = new Map();
const push = (m, k, l) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(l); };
for (const l of listings) { push(byNorm, norm(l.title), l); push(byHead, head(l.title), l); }

// ── 2. products without a listing id ──
const { data: unlinked } = await db.from('products').select('id, slug, title, image_url').eq('active', true).is('etsy_listing_id', null).not('slug', 'like', 'gift-card-%').limit(5000);
const accepted = [], rejected = [];
const claims = new Map();
const rej = (p, why) => rejected.push({ p, why });
for (const p of unlinked || []) {
  try { await matchOne(p); } catch (e) { rej(p, 'error: ' + String(e.message).slice(0, 60)); }
}
async function matchOne(p) {
  if (!p.image_url) { rej(p, 'product has no picture'); return; }
  let ph;
  try { ph = await dhash(p.image_url); } catch (e) { rej(p, 'product picture fetch failed'); return; }

  // Pass A: title
  let list = (byNorm.get(norm(p.title)) || []).filter((l) => !usedListing.has(l.id));
  let how = 'title';
  if (!list.length) { list = (byHead.get(head(p.title)) || []).filter((l) => !usedListing.has(l.id) && jaccard(l.title, p.title) >= 0.7); how = 'title head'; }
  if (list.length > 1) { rej(p, 'ambiguous title (N listings)'); return; }
  if (list.length === 1) {
    const l = list[0];
    const d = l.hash ? dist(ph, l.hash) : 99;
    if (d <= HASH_OK) { accepted.push({ p, l, how, d, ai: 'not needed' }); push(claims, l.id, p.id); return; }
    if (d <= HASH_ASK) {
      const ok = await sameDesign(p.image_url, l.image);
      if (ok === true) { accepted.push({ p, l, how, d, ai: 'YES' }); push(claims, l.id, p.id); return; }
      rej(p, `title matches but pictures differ (d=N, AI said ${ok === false ? 'NO' : 'unsure'})`); return;
    }
    rej(p, 'title matches but pictures differ (d=N)'); return;
  }

  // Pass B: picture first. Mockup frames make many listings hash alike, so
  // the nearest few (up to 5, distance <= PIC_NEAR) go to the cheap model
  // together and it must pick exactly one; the pick is then guarded by the
  // titles sharing at least one meaningful word (or a near-identical hash).
  const near = listings.filter((l) => l.hash && l.image && !usedListing.has(l.id)).map((l) => ({ l, d: dist(ph, l.hash) })).filter((x) => x.d <= PIC_NEAR).sort((a, b) => a.d - b.d).slice(0, 5);
  if (!near.length) { rej(p, 'no Etsy listing with this title or picture'); return; }
  const pick = await pickSame(p.image_url, near.map((x) => x.l.image));
  if (pick === null) { rej(p, 'picture close to N listings but AI picked none'); return; }
  const { l, d } = near[pick];
  const shared = [...words(p.title)].filter((w) => words(l.title).has(w));
  if (!shared.length && d > 6) { rej(p, 'AI picked a listing but the titles share no word'); return; }
  accepted.push({ p, l, how: `picture (${near.length} shown, shared: ${shared.slice(0, 2).join(' ') || 'hash'})`, d, ai: 'PICKED' }); push(claims, l.id, p.id);
}
saveCache();

// one product per listing, then write
let linked = 0, videos = 0;
const final = [];
for (const a of accepted) {
  if ((claims.get(a.l.id) || []).length > 1) { rej(a.p, 'N products claim the same listing'); continue; }
  final.push(a); linked++;
  if (a.l.video?.url) videos++;
  if (!DRY) {
    const patch = { etsy_listing_id: Number(a.l.id) };
    if (a.l.video?.url) { patch.video_url = a.l.video.url; patch.video_thumb = a.l.video.thumb || null; }
    await db.from('products').update(patch).eq('id', a.p.id);
  }
}
console.log(`\nunlinked products: ${(unlinked || []).length} · ACCEPTED: ${linked} (${videos} with a video) · rejected: ${rejected.length} · Gemini checks: ${geminiCalls} (${geminiModel || 'none'})${DRY ? '   [dry run, nothing written]' : ''}`);
console.log('\nAccepted  (website product  <=  Etsy listing · how · picture distance · AI):');
for (const a of final) console.log(`  ✓ ${short(a.p.title)} <= ${short(a.l.title)} ${a.how}, d=${a.d}, ${a.ai}${a.l.video?.url ? ' 🎬' : ''}`);
console.log('\nRejected:');
const byWhy = {};
for (const r of rejected) (byWhy[r.why.replace(/\d+/g, 'N')] ||= []).push(r);
for (const [why, rs] of Object.entries(byWhy)) { console.log(`  ${why}: ${rs.length}`); for (const r of rs.slice(0, 5)) console.log(`     - ${r.p.title.split('|')[0].trim().slice(0, 70)}`); if (rs.length > 5) console.log(`     … ${rs.length - 5} more`); }

// ── 3. videos for already-linked products still missing one ──
const { data: need } = await db.from('products').select('id, slug, etsy_listing_id').eq('active', true).not('etsy_listing_id', 'is', null).is('video_url', null).limit(5000);
let found = 0, none = 0, failed = 0;
for (const p of need || []) {
  try {
    const v = await etsy(`/listings/${p.etsy_listing_id}/videos`);
    const vid = (v.results || []).find((x) => x.video_state === 'active') || (v.results || [])[0];
    if (vid?.video_url) { found++; if (!DRY) await db.from('products').update({ video_url: vid.video_url, video_thumb: vid.thumbnail_url || null }).eq('id', p.id); } else none++;
  } catch (e) { failed++; }
  await sleep(120);
}
console.log(`\nalready-linked products without a video: ${(need || []).length} · video found ${found} · listing has no video ${none} · failed ${failed}`);
