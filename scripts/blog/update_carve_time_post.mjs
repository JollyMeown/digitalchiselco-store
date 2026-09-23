// Strengthen the EXISTING carve-time post instead of publishing a rival to it.
//
// The plan was a new guide, "Why your 3D carve takes six hours". Checking the
// catalogue first showed that post already exists: cnc-relief-carving-time,
// "Why Your Relief Carving Takes Three Days, and How to Make It Three Hours",
// published 2026-09-05, 23,620 characters, and SUBMITTED AND INDEXED in Search
// Console. It already covers where the hours go, the stepover maths, the
// three-pass bit ladder, the tapered ball nose, feeds, and eleven settings that
// waste hours. Stepover appears 28 times, taper 23.
//
// Publishing a near-duplicate would be textbook keyword cannibalisation: two
// pages of ours competing for the same query, splitting the signal, and the
// new one almost certainly losing to the established one while dragging it
// down. The right move is consolidation.
//
// So this adds to the page that already ranks the two things it could not have
// had when it was written:
//   1. the free tool, which now does the arithmetic on the reader's own file
//   2. the fine/coarse comparison photographs, which turn "ridges you can see"
//      from an assertion into evidence
//
//   node scripts/blog/update_carve_time_post.mjs --dry
//   node scripts/blog/update_carve_time_post.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const SRC = path.join(ROOT, '.mockups', 'blog-why-3d-carves-take-hours');
const SLUG = 'cnc-relief-carving-time';
const BUCKET = 'site-media';
const APPLY = process.argv.includes('--apply');
// The post already owns bits.jpg, rough.jpg and finish.jpg. Uploading under
// those names with x-upsert would silently replace published images with
// different pictures, so everything new gets its own name.
const NAMES = { fine: 'stepover-fine', coarse: 'stepover-coarse', bits: 'three-cutters' };

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const U = cfg('PUBLIC_SUPABASE_URL');
const K = cfg('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: K, authorization: `Bearer ${K}` };

async function upload(key) {
  const local = path.join(SRC, `${key}.jpg`);
  if (!fs.existsSync(local)) throw new Error(`missing ${local}`);
  const objectKey = `blog/${SLUG}/${NAMES[key]}.jpg`;
  if (APPLY) {
    const r = await fetch(`${U}/storage/v1/object/${BUCKET}/${objectKey}`, {
      method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
      body: fs.readFileSync(local),
    });
    if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  }
  return `${U}/storage/v1/object/public/${BUCKET}/${objectKey}`;
}

const urls = {};
for (const k of ['fine', 'coarse']) urls[k] = await upload(k);
console.log(`${APPLY ? 'uploaded' : 'would upload'} 3 images`);

const { data: rows } = await fetch(`${U}/rest/v1/posts?select=body,updated_at&slug=eq.${SLUG}`, { headers: H })
  .then((r) => r.json()).then((d) => ({ data: d }));
const post = rows?.[0];
if (!post) { console.error('post not found'); process.exit(1); }
let body = post.body;
const before = body.length;

// ── 1. the comparison pair, right after the stepover maths ──────────────
const COMPARE = `
<figure>
  <img src="${urls.fine}" alt="Close detail of a carved deer relief cut at a fine stepover, the surface smooth and even" loading="lazy" />
</figure>

<figure>
  <img src="${urls.coarse}" alt="The identical detail cut at a coarse stepover, showing visible parallel ridges catching the light" loading="lazy" />
</figure>

<p>Those two photographs are the same carving, the same crop and the same light. The only difference is the stepover. The ridges in the second one are a few hundredths of a millimetre deep, which sounds like nothing, and you can see them from across a room because every crest catches the light and every trough holds a shadow. That is the whole argument: the number is small, the effect is not, and the question is only ever whether sanding removes it faster than the machine avoids it.</p>
`;

const afterMaths = '<h2 id="ladder">The three-pass bit ladder</h2>';
if (!body.includes(urls.fine) && body.includes(afterMaths)) {
  body = body.replace(afterMaths, `${COMPARE}\n${afterMaths}`);
  console.log('  + comparison pair inserted before the bit ladder');
}

// The three-cutter photograph is deliberately NOT inserted: the post already
// carries its own bits.jpg illustrating tooling, and two tool photographs in
// one article is clutter. The new one sits in .mockups if it is ever wanted as
// a replacement.

// ── 3. the tool, which did not exist when this was written ──────────────
const TOOLSECTION = `
<h2 id="your-file">Stop estimating: run it on your own file</h2>

<p>Everything above is the general shape of the problem. The specific answer depends on your model, and we built a free tool that works it out: drop any STL into <a href="/tools/will-it-cut">Will it cut?</a> and its "Make it faster" panel runs every bit and stepover combination against your actual geometry.</p>

<p>It reports two things separately, because they are different decisions and conflating them is how people end up running a 1 mm bit for two days:</p>

<ul>
  <li><strong>The ridges between passes.</strong> These shrink as you lower the stepover, they cost you time, and sanding removes them. This is the trade worth making.</li>
  <li><strong>The detail the cutter cannot physically reach.</strong> This does not change with stepover at all, and no amount of sanding brings it back. It is decided by which cutter you own, not by how you drive it.</li>
</ul>

<p>On a typical detailed relief it will tell you something like: at 10% stepover this takes two hours; your 3 mm bit can run 25% and finish in under an hour, leaving ridges of 0.048 mm, which is less than 220 grit takes off. One button applies the setting. Nothing is uploaded, the whole thing runs in your browser, and it works on files from anywhere, not only ours.</p>
`;
const estimator = '<h2 id="estimate">The back-of-the-envelope time estimator</h2>';
if (!body.includes('/tools/will-it-cut') && body.includes(estimator)) {
  body = body.replace(estimator, `${TOOLSECTION}\n${estimator}`);
  console.log('  + tool section inserted before the estimator');
}

console.log(`body ${before} -> ${body.length} chars`);
if (!APPLY) { console.log('\nDRY RUN. add --apply to write.'); process.exit(0); }

const r = await fetch(`${U}/rest/v1/posts?slug=eq.${SLUG}`, {
  method: 'PATCH', headers: { ...H, 'content-type': 'application/json', prefer: 'return=minimal' },
  body: JSON.stringify({ body, updated_at: new Date().toISOString() }),
});
console.log(r.ok ? 'post updated' : `FAILED ${r.status}: ${(await r.text()).slice(0, 200)}`);
