// Move the free lampshade zips off Google Drive and onto Supabase storage.
//
// Why: Drive throttles a heavily downloaded public file with "Sorry, you can't
// view or download this file at this time", which happens exactly when a
// listing starts working, and Drive gives no download numbers. Storage is
// 97 MB against a 100 GB allowance, and egress is 250 GB included, so at
// 4 MB a zip that is 63,000 downloads before a penny is owed.
//
// Cults3D is NOT affected either way: it fetched and now hosts its own copy at
// creation time, so its download button never touches our storage.
//
//   node scripts/upload_lamp_zips.mjs            # upload, print the URLs
//   node scripts/upload_lamp_zips.mjs --check    # just verify what is there
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const ZIPS = 'D:/LAMP SHADE OGEE/studio/_pack/zips';
const URL_BASE = process.env.PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'site-media';
const PREFIX = 'lamps/zips';
const CHECK = process.argv.includes('--check');

const pub = (k) => `${URL_BASE}/storage/v1/object/public/${BUCKET}/${k}`;

const files = fs.readdirSync(ZIPS).filter((f) => f.endsWith('.zip')).sort();
const out = {};
for (const f of files) {
  const key = `${PREFIX}/${f}`;
  const size = fs.statSync(path.join(ZIPS, f)).size;
  if (CHECK) {
    const r = await fetch(pub(key), { method: 'HEAD' });
    console.log(`${r.status}  ${(size / 1048576).toFixed(1).padStart(5)} MB  ${f}`);
    continue;
  }
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE, authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/zip', 'x-upsert': 'true',
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body: fs.readFileSync(path.join(ZIPS, f)),
  });
  if (!r.ok) { console.error(`FAIL ${f}: ${r.status} ${(await r.text()).slice(0, 140)}`); continue; }
  out[f] = pub(key);
  console.log(`ok  ${(size / 1048576).toFixed(1).padStart(5)} MB  ${f}`);
}
if (!CHECK) {
  fs.writeFileSync('lamp_zip_urls.json', JSON.stringify(out, null, 1));
  console.log(`\n${Object.keys(out).length} uploaded -> lamp_zip_urls.json`);
}
