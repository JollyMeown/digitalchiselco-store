// Replace the pictures on the live Cults3D lampshade listings.
//
// Cults3D copies an image at creation time and serves its own copy, so
// re-uploading to the same Supabase URL changes nothing on their side. The
// only way to update a picture is createIllustration + destroyIllustration,
// and updateCreation cannot touch images at all.
//
// Needed on 2026-09-21 because the listing posters were built from the photos
// taken BEFORE the seam correction, so every thumbnail still showed a Z-seam
// that vase mode does not produce.
//
// New ones go up first, old ones come down after, so a listing is never left
// without pictures if a fetch fails. A cache-busting suffix forces Cults3D to
// refetch rather than reuse what it already has for that URL.
//
//   node scripts/cults3d_refresh_images.mjs            # dry run
//   node scripts/cults3d_refresh_images.mjs --apply
import 'dotenv/config';
import { readFileSync } from 'node:fs';

const U = process.env.CULTS3D_USERNAME, K = process.env.CULTS3D_API_KEY;
const URL_BASE = process.env.PUBLIC_SUPABASE_URL;
const APPLY = process.argv.includes('--apply');
const V = process.argv.includes('--v') ? process.argv[process.argv.indexOf('--v') + 1] : String(Date.now()).slice(-6);

const q = async (query, variables) => {
  const r = await fetch('https://cults3d.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${U}:${K}`).toString('base64') },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  return j.data;
};

const done = JSON.parse(readFileSync('cults3d_lampshades_done.json', 'utf8'));
const img = (key, kind) => `${URL_BASE}/storage/v1/object/public/site-media/lamps/${key}-${kind}.jpg?v=${V}`;
const KINDS = ['poster', 'pendant', 'lit'];

const all = await q('{ myself { creationsBatch(limit:50){ results { name illustrations { id position } } } } }');
const byName = Object.fromEntries((all.myself?.creationsBatch?.results || []).map((c) => [c.name, c]));

let ok = 0, bad = 0;
for (const [key, v] of Object.entries(done)) {
  const c = Object.values(byName).find((x) => x.name.toLowerCase().startsWith(key.replace(/-/g, ' ')));
  if (!c) { console.error(`no live listing matched ${key}`); bad++; continue; }
  const oldIds = (c.illustrations || []).map((i) => i.id);
  if (!APPLY) { console.log(`${key.padEnd(17)} ${oldIds.length} old -> ${KINDS.length} new`); continue; }
  try {
    for (let i = 0; i < KINDS.length; i++) {
      await q('mutation C($c:ID!,$u:String!,$p:Int){ createIllustration(creationId:$c, imageUrl:$u, position:$p){ illustration { id position } errors } }',
        { c: v.id, u: img(key, KINDS[i]), p: i + 1 });
      await new Promise((r) => setTimeout(r, 900));
    }
    for (const id of oldIds) {
      await q('mutation D($id:ID!){ destroyIllustration(id:$id){ errors } }', { id });
      await new Promise((r) => setTimeout(r, 700));
    }
    console.log(`ok   ${key.padEnd(17)} replaced ${oldIds.length} pictures`);
    ok++;
  } catch (e) {
    console.error(`FAIL ${key}: ${e.message.slice(0, 150)}`);
    bad++;
  }
}
if (APPLY) console.log(`\n${ok} refreshed, ${bad} failed`);
else console.log('\ndry run. add --apply');
