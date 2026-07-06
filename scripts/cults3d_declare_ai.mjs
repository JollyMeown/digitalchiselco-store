// Batch-declare AI on existing Cults3D listings: sets madeWithAi:true on every
// creation via updateCreation (a PATCH — only changes the fields passed; we pass
// the creation's CURRENT price back so nothing else changes). Cults requires a
// valid downloadPrice on any update, so we include it.
//
//   node scripts/cults3d_declare_ai.mjs            # DRY RUN — list what would change
//   node scripts/cults3d_declare_ai.mjs --apply    # set madeWithAi:true
//
// Skips the 2 pre-existing manual uploads (bts-idol / octopus) that aren't from
// our catalog — pass --include-all to update those too.
import 'dotenv/config';

const USER = process.env.CULTS3D_USERNAME || '', KEY = process.env.CULTS3D_API_KEY || '';
const auth = 'Basic ' + Buffer.from(`${USER}:${KEY}`).toString('base64');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const APPLY = process.argv.includes('--apply');
const INCLUDE_ALL = process.argv.includes('--include-all');
const SKIP = /bts-idol|octopus/i; // pre-existing non-catalog manual uploads
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2500 * attempt + Math.floor(Math.random() * 2000));
    const res = await fetch('https://cults3d.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA, authorization: auth },
      body: JSON.stringify({ query, variables }),
    });
    const t = await res.text();
    let j; try { j = JSON.parse(t); }
    catch {
      if (attempt < 3 && (res.status === 403 || res.status === 429 || res.status >= 500)) { console.log(`  (Cults ${res.status} — retry ${attempt + 1}/3)`); continue; }
      throw new Error(`Non-JSON (${res.status}): ${t.slice(0, 200)}`);
    }
    if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors));
    return j.data;
  }
}

async function allCreations() {
  const out = []; let offset = 0;
  for (;;) {
    const d = await gql(`query($l:Int,$o:Int){ myself { creationsBatch(limit:$l, offset:$o){ total results { id slug madeWithAi price { value currency } } } } }`, { l: 60, o: offset });
    const b = d.myself.creationsBatch; const res = b.results || [];
    out.push(...res);
    offset += res.length;
    if (res.length < 60 || offset >= (b.total || 0)) break;
  }
  return out;
}

const UPDATE = `mutation($id:ID!,$p:Float,$c:CurrencyEnum){ updateCreation(id:$id, madeWithAi:true, downloadPrice:$p, currency:$c){ creation { id madeWithAi } errors } }`;

const all = await allCreations();
const skipped = all.filter((c) => !INCLUDE_ALL && SKIP.test(c.slug || ''));
const need = all.filter((c) => c.madeWithAi !== true && (INCLUDE_ALL || !SKIP.test(c.slug || '')));
console.log(`Total creations: ${all.length} | already AI-declared: ${all.filter((c) => c.madeWithAi === true).length} | to update: ${need.length} | skipped (manual): ${skipped.length}`);
if (skipped.length) console.log('  skipped slugs:', skipped.map((c) => c.slug).join(', '));

if (!APPLY) {
  console.log('\nDRY RUN — pass --apply to set madeWithAi:true on the above. First few:', need.slice(0, 8).map((c) => c.slug));
} else {
  let ok = 0, fail = 0;
  for (const c of need) {
    try {
      const d = await gql(UPDATE, { id: c.id, p: c.price?.value ?? 4.99, c: c.price?.currency || 'EUR' });
      const r = d.updateCreation;
      if (r.errors && r.errors.length) { fail++; console.log('✗', c.slug, JSON.stringify(r.errors)); }
      else { ok++; console.log('✓', c.slug, '-> madeWithAi', r.creation?.madeWithAi); }
    } catch (e) { fail++; console.log('✗', c.slug, e.message); }
    await sleep(800);
  }
  console.log(`\nDone. Declared AI on ${ok}, failed ${fail}.`);
}
