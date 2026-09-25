// Attach the missing STL zips to the 12 Cults3D lampshade listings.
//
// 2026-09-25: all 12 went Offline (DEACTIVATED) with 0 files. At creation the
// uploader handed Cults a drive.usercontent.com link, and that link answers
// with the two bytes "OK" instead of the zip, so Cults stored nothing and
// moderation switched the empty listings off. Fix, per listing:
//   1. put the local zip in the private `software` bucket, sign a 1-hour URL
//      (the method that worked for the Laser Studio PDF)
//   2. createBlueprint(creationId, fileUrl)
//   3. read the listing back: only when Cults now holds a file, set it PUBLIC
//      again (downloadPrice 0 must be sent: updateCreation re-validates price)
// A few seconds between calls, and a stop at the first CrowdSec page, so the
// fix itself cannot trip the IP block again.
//   node scripts/cults3d_lampshades_fix_files.mjs --only pinecone           # dry run, one
//   node scripts/cults3d_lampshades_fix_files.mjs --only pinecone --apply   # fix one
//   node scripts/cults3d_lampshades_fix_files.mjs --apply                   # fix all
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })();
const ZIPS = 'D:/LAMP SHADE OGEE/studio/_pack/zips';
const U = process.env.PUBLIC_SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = { apikey: SK, authorization: `Bearer ${SK}` };
const USER = process.env.CULTS3D_USERNAME, KEY = process.env.CULTS3D_API_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables = {}) {
  const r = await fetch('https://cults3d.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA, authorization: 'Basic ' + Buffer.from(`${USER}:${KEY}`).toString('base64') },
    body: JSON.stringify({ query, variables }),
  });
  const t = await r.text();
  if (r.status === 403 && /Access Denied|crowdsec/i.test(t)) { console.error('STOPPED: Cults3D is blocking this IP again.'); process.exit(2); }
  const j = JSON.parse(t);
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}
const files = async (slug) => (await gql('query($s:String!){ creation(slug:$s){ visibility blueprints { fileUrl } } }', { s: slug })).creation;

const done = JSON.parse(fs.readFileSync('cults3d_lampshades_done.json', 'utf8'));
const keys = Object.keys(done).filter((k) => !ONLY || k === ONLY);
console.log(`${keys.length} listing(s)${APPLY ? '' : ' (dry run)'}`);
let fixed = 0;
for (const k of keys) {
  const { id, url } = done[k];
  const slug = url.split('/').pop();
  const zip = path.join(ZIPS, `VaseLampshadeStudio_${k}.zip`);
  if (!fs.existsSync(zip)) { console.log(`✗ ${k}: no local zip`); continue; }
  const before = await files(slug);
  console.log(`${k}: ${before.visibility}, ${before.blueprints.length} file(s) on Cults, local ${(fs.statSync(zip).size / 1e6).toFixed(1)} MB`);
  if (!APPLY) continue;
  if (!before.blueprints.length) {
    const keyPath = `cults/lamps/${path.basename(zip)}`;
    const up = await fetch(`${U}/storage/v1/object/software/${keyPath}`, { method: 'POST', headers: { ...SB, 'content-type': 'application/zip', 'x-upsert': 'true' }, body: fs.readFileSync(zip) });
    if (!up.ok) { console.log(`  ✗ storage upload ${up.status}`); continue; }
    const signed = await fetch(`${U}/storage/v1/object/sign/software/${keyPath}`, { method: 'POST', headers: { ...SB, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) }).then((r) => r.json());
    const fileUrl = `${U}/storage/v1${signed.signedURL}&download=${encodeURIComponent(path.basename(zip))}`;
    await gql('mutation($c:ID!,$f:String!){ createBlueprint(creationId:$c, fileUrl:$f, position:0){ __typename } }', { c: id, f: fileUrl });
    await sleep(8000);                       // let Cults fetch and store the file
  }
  const mid = await files(slug);
  if (!mid.blueprints.length) { console.log('  ✗ Cults still has no file; left offline'); await sleep(3000); continue; }
  if (mid.visibility !== 'PUBLIC') {
    await gql('mutation($id:ID!){ updateCreation(id:$id, visibility:PUBLIC, downloadPrice:0){ __typename } }', { id });
    await sleep(3000);
  }
  const after = await files(slug);
  console.log(`  ✓ ${after.visibility}, ${after.blueprints.length} file(s)`);
  if (after.blueprints.length && after.visibility === 'PUBLIC') fixed++;
  await sleep(4000);
}
console.log(`done: ${fixed} fixed`);
