// Publish (or re-publish) the relief finishing guide.
//
// The article body lives in scripts/blog/finishing-guide.html with {{IMG:key}}
// placeholders, and the step photographs live in the site-media bucket under
// blog/finishing/. This joins the two and upserts the post, so editing the HTML
// and running this again updates the live article without touching anything else.
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

const IMG = (key) => `${URL_BASE}/storage/v1/object/public/site-media/blog/finishing/${key}.jpg`;

const SLUG = 'how-to-finish-cnc-relief-carvings';
let body = fs.readFileSync(path.join(HERE, 'blog', 'finishing-guide.html'), 'utf8')
  .replace(/\{\{IMG:([a-z-]+)\}\}/g, (_, k) => IMG(k));

const missing = body.match(/\{\{IMG:[^}]+\}\}/g);
if (missing) { console.error('unresolved image placeholders:', missing); process.exit(1); }

const post = {
  slug: SLUG,
  title: 'How to Finish a CNC Relief Carving: The Complete Guide',
  excerpt:
    'Finishing is what decides whether a relief carving reads or falls flat. The full method, from '
    + 'machining fuzz to the antique glaze that makes the depth show, with the products and tools that work.',
  body,
  cover_image_url: IMG('cover'),
  author: 'Jolly',
  status: 'published',
  seo_title: 'How to Finish a CNC Relief Carving (Step by Step Guide)',
  seo_description:
    'Step by step guide to finishing CNC relief carvings: removing fuzz, sealing, the antique glaze that '
    + 'makes depth read, oils, waxes, food safe trays and 3D printed reliefs.',
  published_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const existing = await fetch(`${URL_BASE}/rest/v1/posts?select=id&slug=eq.${SLUG}`, { headers: H })
  .then((r) => r.json());

let r;
if (Array.isArray(existing) && existing.length) {
  delete post.published_at;                       // keep the original publish date
  r = await fetch(`${URL_BASE}/rest/v1/posts?id=eq.${existing[0].id}`, {
    method: 'PATCH', headers: H, body: JSON.stringify(post),
  });
  console.log(r.ok ? 'updated' : `update failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
} else {
  r = await fetch(`${URL_BASE}/rest/v1/posts`, { method: 'POST', headers: H, body: JSON.stringify(post) });
  console.log(r.ok ? 'published' : `insert failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
if (r.ok) {
  console.log(`  https://digitalchiselco.com/blog/${SLUG}`);
  console.log(`  ${body.length} chars, ${(body.match(/<img /g) || []).length} images, `
    + `${body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length} words`);
}
