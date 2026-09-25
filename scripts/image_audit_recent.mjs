// Audit every picture on products added in the last N days (default 9):
// file size, pixel size, format, broken links, the same file on two
// products (Supabase ETag = content hash). Read-only; writes a JSON report.
//   node scripts/image_audit_recent.mjs [--days 9] [--out report.json]
import 'dotenv/config';
import fs from 'node:fs';
import { imageSize } from 'image-size';
const U = process.env.PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', 9)), OUT = arg('--out', 'image_audit.json');
const since = new Date(Date.now() - DAYS * 86400e3).toISOString().slice(0, 10);
const H = { apikey: K, authorization: `Bearer ${K}` };
const products = await fetch(`${U}/rest/v1/products?select=id,slug,title,active,created_at,submitted_by,image_url,gallery,setup_card_url,mockup_url,mockup_b_url,macro_url&created_at=gte.${since}&order=created_at.desc`, { headers: H }).then((r) => r.json());

const jobs = [];
for (const p of products) {
  const add = (role, url) => url && jobs.push({ pid: p.id, slug: p.slug, role, url });
  add('main', p.image_url);
  (Array.isArray(p.gallery) ? p.gallery : []).forEach((u, i) => { if (u !== p.image_url) add('gallery' + i, u); });
  add('setup_card', p.setup_card_url); add('mockup', p.mockup_url); add('mockup_b', p.mockup_b_url); add('macro', p.macro_url);
}
async function probe(j) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(j.url, { headers: { range: 'bytes=0-262143' } });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.status >= 400) return { ...j, status: r.status };
      const total = Number((r.headers.get('content-range') || '').split('/')[1] || r.headers.get('content-length') || buf.length);
      let dim = {}; try { dim = imageSize(buf); } catch {}
      return { ...j, status: r.status, bytes: total, w: dim.width, h: dim.height, type: dim.type, ctype: r.headers.get('content-type'), etag: r.headers.get('etag') };
    } catch (e) { if (t === 2) return { ...j, status: 'ERR ' + e.message }; }
  }
}
const res = []; let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (i < jobs.length) { const j = jobs[i++]; res.push(await probe(j)); } }));
fs.writeFileSync(OUT, JSON.stringify({ since, products: products.map((p) => ({ id: p.id, slug: p.slug, title: p.title, active: p.active, created_at: p.created_at, submitted_by: p.submitted_by, image_url: p.image_url, gallery: p.gallery })), images: res }, null, 1));

const mb = (b) => (b / 1e6).toFixed(2) + ' MB';
const ok = res.filter((r) => r.bytes);
console.log(`${products.length} products since ${since}, ${res.length} pictures, total ${mb(ok.reduce((s, r) => s + r.bytes, 0))}`);
console.log('broken:', res.filter((r) => !r.bytes).map((r) => `${r.status} ${r.role} ${r.slug}`));
console.log('no main picture:', products.filter((p) => !p.image_url).map((p) => p.slug));
const byRole = {}; for (const r of ok) { const k = r.role.replace(/\d+$/, ''); (byRole[k] ??= []).push(r); }
for (const [k, rs] of Object.entries(byRole)) {
  const s = rs.map((r) => r.bytes).sort((a, b) => a - b);
  console.log(`${k}: n=${rs.length} median ${mb(s[s.length >> 1])} max ${mb(s[s.length - 1])} | >1MB ${rs.filter((r) => r.bytes > 1e6).length} | >2000px ${rs.filter((r) => Math.max(r.w || 0, r.h || 0) > 2000).length} | types ${[...new Set(rs.map((r) => r.type))].join(',')} | dims ${[...new Set(rs.map((r) => r.w + 'x' + r.h))].slice(0, 6).join(' ')}`);
}
const byEtag = {}; for (const r of ok) if (r.etag) (byEtag[r.etag] ??= new Set()).add(r.slug);
const dups = Object.entries(byEtag).filter(([, s]) => s.size > 1).map(([e, s]) => [...s]);
console.log('same file on different products:', dups.length, JSON.stringify(dups.slice(0, 10)));
const typeMismatch = ok.filter((r) => r.type && r.ctype && !r.ctype.includes(r.type === 'jpg' ? 'jpeg' : r.type));
console.log('extension/content mismatch:', typeMismatch.length);
setTimeout(() => process.exit(0), 100);
