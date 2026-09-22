// Push the current listing copy to the live Cults3D lampshade listings.
//
// The description text lives in ONE place, cults3d_lampshades.mjs, so editing
// it there and running this keeps the twelve live listings in step. Safe to
// re-run: it rewrites the description and nothing else.
//
//   node scripts/cults3d_sync_descriptions.mjs --check   # reachability only
//   node scripts/cults3d_sync_descriptions.mjs           # push to all twelve
//
// NEEDS THE VPN OFF. cults3d.com does not resolve through it, and with it on
// Node fails TLS with UNABLE_TO_VERIFY_LEAF_SIGNATURE because the VPN presents
// its own certificate. Do NOT "fix" that by disabling certificate checking:
// this request carries the Cults3D API key.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SELF = path.join(HERE, 'cults3d_lampshades.mjs');
const LEDGER = path.join(ROOT, 'cults3d_lampshades_done.json');
const REPORT = 'D:/LAMP SHADE OGEE/studio/_pack/_report.json';

const U = process.env.CULTS3D_USERNAME, K = process.env.CULTS3D_API_KEY;
if (!U || !K) { console.error('CULTS3D_USERNAME / CULTS3D_API_KEY missing from .env'); process.exit(1); }

// reuse the single source of truth for the copy
const src = fs.readFileSync(SELF, 'utf8');
const description = new Function('d', src.split('function description(d) {')[1].split('\n}')[0]);

const q = async (query, variables) => {
  const r = await fetch('https://cults3d.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${U}:${K}`).toString('base64') },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
};

if (process.argv.includes('--check')) {
  try {
    const j = await q('{ myself { user { nick } } }');
    console.log('reachable, signed in as', j.data?.myself?.user?.nick || '(unknown)');
  } catch (e) {
    console.error('NOT reachable:', String(e.cause?.code || e.message));
    console.error('Turn the VPN off and try again.');
    process.exit(1);
  }
  process.exit(0);
}

const done = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const rep = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
// the id encodes the slug and CHANGES on publish, so refresh it before writing
const live = await q('{ myself { creationsBatch(limit:50){ results { name identifier } } } }');
const byKey = {};
for (const c of live.data?.myself?.creationsBatch?.results || []) {
  if (!/Lampshade - One Piece/.test(c.name)) continue;
  byKey[c.name.split(' Lampshade')[0].toLowerCase().replace(/ /g, '-')] = c.identifier;
}
if (Object.keys(byKey).length) {
  for (const k of Object.keys(done)) if (byKey[k]) done[k].id = byKey[k];
  fs.writeFileSync(LEDGER, JSON.stringify(done, null, 1));
}

const M = 'mutation U($id:ID!,$d:String!){ updateCreation(id:$id, description:$d, downloadPrice:0, madeWithAi:false, visibility:PUBLIC){ creation{ name description } errors } }';
let ok = 0, bad = 0;
for (const d of rep) {
  const v = done[d.key];
  if (!v) { console.error(`no ledger entry for ${d.key}`); bad++; continue; }
  const r = await q(M, { id: v.id, d: description(d) });
  const c = r.data?.updateCreation;
  if (c?.creation) { console.log(`ok   ${d.key.padEnd(17)} desktop line: ${/STANDALONE WINDOWS DESKTOP/.test(c.creation.description)}`); ok++; }
  else { console.error(`FAIL ${d.key}: ${JSON.stringify(r.errors || c?.errors).slice(0, 120)}`); bad++; }
  await new Promise((r) => setTimeout(r, 1400));
}
console.log(`\n${ok} updated, ${bad} failed`);
process.exit(bad ? 1 : 0);
