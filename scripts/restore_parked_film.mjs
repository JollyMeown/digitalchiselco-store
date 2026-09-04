// Restore a film that BRS parked, or overwrote, back onto the website.
//
// Until 2026-09-04 publishing a second film for a design PATCHED the existing
// row, so the earlier film disappeared from the site even though BRS had kept
// every file under <design>/_video/_films/<stamp>-<slug>/. This puts one of
// those back as its own row, alongside whatever is live now.
//
// Usage:
//   node scripts/restore_parked_film.mjs "<parked film dir>" <product_id> [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const URL_BASE = cfg('PUBLIC_SUPABASE_URL');
const SERVICE = cfg('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SERVICE, authorization: `Bearer ${SERVICE}` };
const BUCKET = 'site-media';

const [dir, productId] = process.argv.slice(2);
const DRY = process.argv.includes('--dry');
if (!dir || !productId) { console.error('usage: restore_parked_film.mjs "<dir>" <product_id> [--dry]'); process.exit(1); }

const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
const story = project.story || {};
const title = String(story.title || 'Untitled film').slice(0, 120);
const caption = String(story.logline || '').slice(0, 200);
// BRS names its uploads <slug>-<stamp>; keep the parked folder's own stamp so a
// restore can never collide with the file that replaced it.
const base = path.basename(dir).replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 70);

const video = fs.existsSync(path.join(dir, 'FINAL_web.mp4'))
  ? path.join(dir, 'FINAL_web.mp4') : path.join(dir, 'FINAL.mp4');
const poster = path.join(dir, 'poster.jpg');
const posterEmail = path.join(dir, 'poster_email.jpg');
for (const f of [video, poster]) if (!fs.existsSync(f)) { console.error('missing', f); process.exit(1); }

async function put(key, file, type) {
  const body = fs.readFileSync(file);
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST', headers: { ...H, 'content-type': type, 'x-upsert': 'true' }, body,
  });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status} ${(await r.text()).slice(0, 140)}`);
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${key}`;
}

console.log(`restoring "${title}"`);
console.log(`  video  ${(fs.statSync(video).size / 1048576).toFixed(1)} MB`);
if (DRY) { console.log('  (dry run, nothing uploaded)'); process.exit(0); }

const videoUrl = await put(`videos/${base}.mp4`, video, 'video/mp4');
const posterUrl = await put(`videos/${base}-poster.jpg`, poster, 'image/jpeg');
// send-film derives the taller mail poster by swapping -poster.jpg for -email.jpg
if (fs.existsSync(posterEmail)) await put(`videos/${base}-email.jpg`, posterEmail, 'image/jpeg');

const row = {
  product_id: productId, video_url: videoUrl, poster_url: posterUrl,
  title, caption, sort_order: 1, active: true,
  runtime_seconds: Number(process.env.RUNTIME_SECONDS) || null,
};
const r = await fetch(`${URL_BASE}/rest/v1/showcase_videos`, {
  method: 'POST',
  headers: { ...H, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify(row),
});
const made = await r.json();
if (!r.ok) { console.error('insert failed', r.status, JSON.stringify(made).slice(0, 240)); process.exit(1); }
console.log(`  restored as film ${made[0]?.id}`);
console.log(`  ${videoUrl}`);
console.log('  Write its email copy in Admin > Media > Sawdust Cinema before sending.');
