// Render one article locally for review BEFORE it is published: post.html
// with the frames from .mockups/blog-<slug>/ and the picks resolved, in the
// article styling. Writes <out>/preview.html plus a copy of every image.
//
//   node scripts/blog/preview_post.mjs <slug> [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const args = process.argv.slice(2);
const SLUG = args.find((a) => !a.startsWith('--'));
if (!SLUG) { console.error('usage: preview_post.mjs <slug> [--out dir]'); process.exit(1); }
const oi = args.indexOf('--out');
const OUT = oi >= 0 ? args[oi + 1] : path.join(ROOT, '.mockups', `blog-${SLUG}`, 'preview');
fs.mkdirSync(OUT, { recursive: true });

const DIR = path.join(HERE, SLUG);
const MOCK = path.join(ROOT, '.mockups', `blog-${SLUG}`);
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const frames = fs.existsSync(path.join(DIR, 'frames.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'frames.json'), 'utf8')) : [];
const picks = fs.existsSync(path.join(DIR, 'picks.json'))
  ? Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DIR, 'picks.json'), 'utf8')).map((p) => [p.key, p])) : {};

const img = {};
for (const f of frames) {
  const src = path.join(MOCK, `${f.key}.jpg`);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(OUT, `${f.key}.jpg`)); img[f.key] = `${f.key}.jpg`; }
}
const pick = (k, f) => {
  const p = picks[k]; if (!p) return `[missing pick ${k}]`;
  if (f === 'URL') return `https://digitalchiselco.com/product/${p.slug}`;
  if (f === 'TITLE') return p.title;
  if (f === 'PRICE') return `$${Number(p.price).toFixed(2)}`;
  return p.mockA || p.mockB || p.hero;
};
const body = fs.readFileSync(path.join(DIR, 'post.html'), 'utf8')
  .replace(/\{\{IMG:([a-z0-9-]+)\}\}/g, (_, k) => img[k] || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="100%" height="100%" fill="#e8dcc4"/><text x="50%" y="50%" font-size="60" text-anchor="middle" fill="#633806">frame "${k}" not generated yet</text></svg>`)}`)
  .replace(/\{\{(URL|TITLE|PRICE|MOCK):([a-z0-9-]+)\}\}/g, (_, f, k) => pick(k, f))
  .replace(/href="\/(?!\/)/g, 'href="https://digitalchiselco.com/');
const cover = String(meta.cover || '').startsWith('pick:') ? pick(meta.cover.slice(5), 'MOCK') : img[meta.cover];

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PREVIEW · ${meta.title}</title>
<style>
  body{margin:0;background:#FAEEDA;color:#2b1a05;font:17px/1.65 Georgia,'Times New Roman',serif}
  .wrap{max-width:760px;margin:0 auto;padding:24px 20px 80px}
  .flag{background:#854F0B;color:#FAEEDA;padding:8px 14px;border-radius:8px;font-size:14px;letter-spacing:.04em;text-transform:uppercase;display:inline-block;margin-bottom:18px}
  h1{font-size:2.1rem;line-height:1.15;margin:.2em 0 .4em;color:#412402}
  .excerpt{font-size:1.1rem;color:#633806;margin-bottom:1.4rem}
  .cover img{width:100%;border-radius:12px;box-shadow:0 8px 30px rgba(65,36,2,.18)}
  .post-body h2{font-weight:600;color:#412402;font-size:1.6rem;margin:2.2rem 0 .6rem}
  .post-body h2::after{content:'';display:block;width:3.5rem;height:3px;border-radius:2px;background:#854F0B;margin-top:.6rem}
  .post-body h3{font-weight:600;color:#633806;font-size:1.2rem;margin:1.6rem 0 .3rem}
  .post-body h3::before{content:'';display:inline-block;width:.45rem;height:.45rem;border-radius:50%;background:#854F0B;margin:0 .55rem .15rem 0}
  .post-body h2#contents{font-size:1.05rem;letter-spacing:.04em;text-transform:uppercase;color:#854F0B;margin-bottom:.5rem}
  .post-body h2#contents+ul{list-style:none;padding:.9rem 1.1rem;margin:0 0 2rem;background:#fff7e8;border:1px solid #e3cfa9;border-radius:10px;columns:2;column-gap:2rem}
  .post-body h2#contents+ul>li{padding:.2rem 0 .2rem 1.1rem;position:relative;font-size:.95rem;break-inside:avoid}
  .post-body h2#contents+ul>li::before{content:'▸';position:absolute;left:0;top:.2rem;color:#854F0B}
  .post-body h2#contents+ul a{text-decoration:none;color:#633806}
  .post-body a{color:#854F0B}
  .post-body a.dl-btn{display:inline-block;margin:.1rem 0 1.4rem;padding:.6rem 1.1rem;border-radius:.6rem;background:#854F0B;color:#FAEEDA;text-decoration:none;font-weight:700}
  .post-body a.dl-btn::after{content:' →'}
  .post-body figure{margin:1.6rem 0}
  .post-body figure img{border-radius:.75rem;width:100%;box-shadow:0 6px 24px rgba(65,36,2,.12);display:block}
  .post-body figcaption{font-size:.9rem;color:#633806;margin-top:.5rem;font-style:italic}
  .post-body table{border-collapse:collapse;width:100%;font-size:.92rem;margin:1rem 0}
  .post-body th,.post-body td{border:1px solid #e3cfa9;padding:.45rem .6rem;text-align:left;vertical-align:top}
  .post-body th{background:#fff7e8}
  .post-body ul,.post-body ol{padding-left:1.4rem}
  .post-body li{margin:.3rem 0}
  .post-body hr{border:0;border-top:1px solid #e3cfa9;margin:2rem 0}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin:1.5rem 0}
  .grid a{display:block;border:1px solid rgba(0,0,0,.1);border-radius:.5rem;overflow:hidden;text-decoration:none;color:#2b1a05}
  .grid img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
  .grid .p-2{padding:.5rem;font-size:.75rem}
  .grid .text-bronze-700{color:#854F0B;font-weight:600}
  @media(max-width:600px){.grid{grid-template-columns:repeat(2,1fr)}.post-body h2#contents+ul{columns:1}}
</style></head><body><div class="wrap">
<div class="flag">Preview · not published</div>
<h1>${meta.title}</h1>
<p class="excerpt">${meta.excerpt}</p>
${cover ? `<div class="cover"><img src="${cover}" alt=""></div>` : ''}
<div class="post-body">${body}</div>
</div></body></html>`;
fs.writeFileSync(path.join(OUT, 'preview.html'), html);
const missing = frames.filter((f) => !img[f.key] && !/^(email|pin)$/.test(f.key)).map((f) => f.key);
console.log(`preview → ${path.join(OUT, 'preview.html')}  (${Object.keys(img).length} images${missing.length ? `, missing: ${missing.join(' ')}` : ''})`);
