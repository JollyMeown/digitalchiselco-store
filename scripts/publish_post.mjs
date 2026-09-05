// Publish (or re-publish) one blog article.
//
//   scripts/blog/<slug>/post.html      body, with {{IMG:key}} placeholders
//   scripts/blog/<slug>/meta.json      { title, excerpt, seo_title, seo_description, cover: "<key>" }
//   scripts/blog/<slug>/manifest.json  written by gen_blog_frames.mjs --upload-existing
//
// Re-running updates the live article in place and keeps its original publish
// date, so editing the HTML is safe at any time.
//
// Usage:  node scripts/publish_post.mjs <slug> [--draft]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const URL_BASE = cfg('PUBLIC_SUPABASE_URL');
const SERVICE = cfg('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' };

const args = process.argv.slice(2);
const SLUG = args.find((a) => !a.startsWith('--'));
if (!SLUG) { console.error('usage: publish_post.mjs <slug> [--draft]'); process.exit(1); }
const DIR = path.join(HERE, 'blog', SLUG);
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const manifest = fs.existsSync(path.join(DIR, 'manifest.json'))
  ? JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) : [];
const img = Object.fromEntries(manifest.map((m) => [m.key, m.url]));

// Optional picks.json: real products the article features. Placeholders
// {{URL:key}} {{TITLE:key}} {{PRICE:key}} {{MOCK:key}} resolve from it, so a
// price change or a new approved mockup only needs a republish, not an edit.
const picks = fs.existsSync(path.join(DIR, 'picks.json'))
  ? Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DIR, 'picks.json'), 'utf8')).map((p) => [p.key, p])) : {};
const pick = (k, f) => {
  const p = picks[k];
  if (!p) return `{{MISSING:pick:${k}}}`;
  if (f === 'URL') return `/product/${p.slug}`;
  if (f === 'TITLE') return p.title;
  if (f === 'PRICE') return `$${Number(p.price).toFixed(2)}`;
  if (f === 'MOCK') return p.mockA || p.mockB || p.hero;   // approved mockup first, hero as fallback
  return `{{MISSING:${f}:${k}}}`;
};

let body = fs.readFileSync(path.join(DIR, 'post.html'), 'utf8')
  .replace(/\{\{IMG:([a-z0-9-]+)\}\}/g, (_, k) => img[k] || `{{MISSING:${k}}}`)
  .replace(/\{\{(URL|TITLE|PRICE|MOCK):([a-z0-9-]+)\}\}/g, (_, f, k) => pick(k, f));
const missing = body.match(/\{\{MISSING:[^}]+\}\}/g);
if (missing && !args.includes('--check')) { console.error('unresolved:', [...new Set(missing)].join(' ')); process.exit(1); }
if (missing) console.log('not yet resolved (fine before frames are uploaded):', [...new Set(missing)].join(' '));
if (/—/.test(body)) { console.error('em dash found in body; the owner does not use them'); process.exit(1); }

// --check: resolve everything and report, publish nothing. Run it before the
// frames exist to catch a typo in a placeholder or a broken internal link.
if (args.includes('--check')) {
  const links = [...body.matchAll(/href="(\/[^"#]+)/g)].map((m) => m[1]);
  const uniq = [...new Set(links)];
  let bad = 0;
  for (const l of uniq) {
    const r = await fetch(`https://digitalchiselco.com${l}`, { method: 'GET', redirect: 'follow' }).catch(() => null);
    const okStatus = r && r.status < 400;
    if (!okStatus) { bad++; console.log(`  ${r ? r.status : 'ERR'}  ${l}`); }
  }
  const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  console.log(`check ok: ${words} words, ${(body.match(/<img /g) || []).length} images, ${uniq.length} internal links, ${bad} broken`);
  process.exit(bad ? 1 : 0);
}

const post = {
  slug: SLUG,
  title: meta.title,
  excerpt: meta.excerpt,
  body,
  cover_image_url: img[meta.cover] || null,
  author: 'Jolly',
  status: args.includes('--draft') ? 'draft' : 'published',
  seo_title: meta.seo_title,
  seo_description: meta.seo_description,
  updated_at: new Date().toISOString(),
};

const existing = await fetch(`${URL_BASE}/rest/v1/posts?select=id&slug=eq.${SLUG}`, { headers: H }).then((r) => r.json());
let r;
if (Array.isArray(existing) && existing.length) {
  r = await fetch(`${URL_BASE}/rest/v1/posts?id=eq.${existing[0].id}`, { method: 'PATCH', headers: H, body: JSON.stringify(post) });
  console.log(r.ok ? 'updated' : `update failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
} else {
  post.published_at = new Date().toISOString();
  r = await fetch(`${URL_BASE}/rest/v1/posts`, { method: 'POST', headers: H, body: JSON.stringify(post) });
  console.log(r.ok ? 'published' : `insert failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
if (r.ok) {
  const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  console.log(`  https://digitalchiselco.com/blog/${SLUG}`);
  console.log(`  ${words} words, ${(body.match(/<img /g) || []).length} images, ${(body.match(/href="\/(product|blog|catalog|collections|seasonal|designs)/g) || []).length} internal links`);
}
