// Rolling tag + meta-tag refresh for EXISTING Cults3D listings.
//
// Why: Cults' co-founder (Pierre, 2026-09-01) confirmed AI-labelled designs are
// deliberately filtered out of default search and that policy will not change.
// The one lever he offered was "adding meta tags and keywords really helps with
// SEO" — those drive both the include-AI search results and how the listing
// pages rank in Google. Our uploader only sets tags at CREATE time, so the
// ~884 listings already live never benefit from improved keywords.
//
// This walks the whole catalogue at a polite pace (default 20/day, oldest
// first) and rewrites tagNames + metaTags from the product's current SEO
// keywords. Runs LOCALLY like the uploader: Cults' Cloudflare serves 403s to
// shared cloud IPs.
//
// Usage:
//   node scripts/cults3d_retag.mjs --dry-run       # show what would change
//   node scripts/cults3d_retag.mjs                 # update 20 listings
//   node scripts/cults3d_retag.mjs --limit 5
import 'dotenv/config';

const ENDPOINT = 'https://cults3d.com/graphql';
const USER = process.env.CULTS3D_USERNAME;
const KEY = process.env.CULTS3D_API_KEY;
const SUPA = process.env.PUBLIC_SUPABASE_URL;
const SRV = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = Number((args.find((a) => a.startsWith('--limit')) || '').split(/[= ]/)[1]) || Number(args[args.indexOf('--limit') + 1]) || 20;
const MAX_TAGS = 12;
const CORE = ['bas relief', 'cnc', 'stl', '3d print', 'wall art', 'wood carving'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!USER || !KEY) { console.error('CULTS3D_USERNAME / CULTS3D_API_KEY missing'); process.exit(1); }

async function gql(query, variables = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2500 * attempt + Math.floor(Math.random() * 2000));
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9', 'user-agent': UA,
        authorization: 'Basic ' + Buffer.from(`${USER}:${KEY}`).toString('base64'),
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (!res.ok) { if (res.status === 403 || res.status >= 500) continue; throw new Error(`${res.status} ${text.slice(0, 200)}`); }
    let json; try { json = JSON.parse(text); } catch { continue; }
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
    return json.data;
  }
  throw new Error('cults api unreachable after retries');
}

const sb = async (path, init = {}) => {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRV, authorization: `Bearer ${SRV}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
};

// Same budget rules as the uploader: Cults caps total tag characters at 300.
function buildTags(keywords) {
  const tags = []; const seen = new Set(); let chars = 0;
  const add = (raw) => {
    const t = String(raw || '').trim();
    if (!t || t.length > 40) return;
    const k = t.toLowerCase();
    if (seen.has(k) || tags.length >= MAX_TAGS || chars + t.length + 2 > 270) return;
    tags.push(t); seen.add(k); chars += t.length + 2;
  };
  for (const k of (Array.isArray(keywords) ? keywords : [])) add(k);
  for (const k of CORE) add(k);
  return tags;
}

const slugOf = (url) => String(url || '').split('?')[0].replace(/\/$/, '').split('/').pop();

(async () => {
  const rows = await sb(`products?select=id,slug,seo_keywords,cults3d_url,cults3d_retagged_at`
    + `&cults3d_url=not.is.null&order=cults3d_retagged_at.asc.nullsfirst&limit=${LIMIT}`);
  console.log(`${rows.length} listing(s) queued${DRY ? ' (dry run)' : ''}\n`);

  let ok = 0, failed = 0, skipped = 0;
  for (const p of rows) {
    const slug = slugOf(p.cults3d_url);
    const tags = buildTags(p.seo_keywords);
    if (!slug || tags.length === 0) { console.log(`- ${p.slug}: no slug/keywords, skipped`); skipped++; continue; }
    try {
      // updateCreation re-validates the WHOLE record, so the current price must
      // be sent back or it reads as 0 and fails ("Price must be >= 0.5").
      const found = await gql(`query($s:String!){ creation(slug:$s){ id name price { value currency } } }`, { s: slug });
      const id = found?.creation?.id;
      if (!id) { console.log(`- ${slug}: not found on Cults, skipped`); skipped++; continue; }
      const price = Number(found.creation.price?.value) || 0;
      const currency = found.creation.price?.currency || 'EUR';
      if (!(price >= 0.5)) { console.log(`- ${slug}: price ${price} below Cults minimum, skipped`); skipped++; continue; }
      if (DRY) {
        console.log(`- ${slug}\n    tags: ${tags.join(', ')}`);
        ok++;
      } else {
        // payload is { creation, errors } — there is no top-level id field
        // NOTE: metaTags is accepted by the schema but the server returns
        // "Unexpected error!" for any value, so only tagNames is written.
        const upd = await gql(
          `mutation($id:ID!,$tagNames:[String!],$p:Float,$c:CurrencyEnum){
             updateCreation(id:$id, tagNames:$tagNames, downloadPrice:$p, currency:$c){ creation{ id } errors } }`,
          { id, tagNames: tags, p: price, c: currency },
        );
        const errs = upd?.updateCreation?.errors;
        if (errs?.length) throw new Error(Array.isArray(errs) ? errs.join('; ') : String(errs));
        await sb(`products?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ cults3d_retagged_at: new Date().toISOString() }) });
        console.log(`✓ ${slug} — ${tags.length} tags`);
        ok++;
      }
      await sleep(1500 + Math.floor(Math.random() * 1500));   // be polite to Cloudflare
    } catch (e) {
      console.error(`✗ ${slug}: ${e.message}`);
      failed++;
      await sleep(4000);
    }
  }
  console.log(`\ndone: ${ok} updated, ${skipped} skipped, ${failed} failed`);
})();
