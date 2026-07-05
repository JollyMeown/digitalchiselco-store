// Automated Cults3D listing creator.
//
// Creates paid Cults3D listings for our products via the Cults3D GraphQL API
// (createCreation), building each listing entirely from data we already have:
//   - name/description/tags  -> products.seo_title / description / seo_keywords
//   - images                 -> products.image_url + gallery (Supabase .jpg URLs)
//   - the STL file           -> the product's Google Drive file, served via a
//                               drive.usercontent.com link that exposes the
//                               real filename + extension (required by Cults3D).
//
// No files are downloaded or re-hosted: Cults3D fetches each asset from its URL.
//
// Auth: generate an API key at https://cults3d.com/en/api/keys, then set in .env:
//   CULTS3D_USERNAME=your_cults_username
//   CULTS3D_API_KEY=the_generated_key
// (LOCAL ONLY — never add to Netlify. This script runs on the dev machine.)
//
// Usage:
//   node scripts/cults3d_upload.mjs                       # DRY RUN, top 20 bestsellers -> writes cults3d-upload-preview.json
//   node scripts/cults3d_upload.mjs --limit 5             # dry run, first 5
//   node scripts/cults3d_upload.mjs --all                 # dry run over the whole catalog
//   node scripts/cults3d_upload.mjs --introspect          # (needs key) print createCreation arg types
//   node scripts/cults3d_upload.mjs --list-categories     # (needs key) print category ids
//   node scripts/cults3d_upload.mjs --list-licenses       # (needs key) print license codes
//   node scripts/cults3d_upload.mjs --apply --category-id <ID> --license-code <CODE> --limit 1   # LIVE: create 1 listing
//   node scripts/cults3d_upload.mjs --apply --category-id <ID> --license-code <CODE>             # LIVE: top 20 bestsellers
//
// Idempotent: every successful creation is recorded in cults3d_uploaded.json
// (git-ignored) and skipped on later runs.

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SITE = process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
const ENDPOINT = 'https://cults3d.com/graphql';
const USER = process.env.CULTS3D_USERNAME || '';
const KEY = process.env.CULTS3D_API_KEY || '';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || ''; // Drive API media download (large files)

// Strip secrets from anything we log (the repo + GitHub Actions logs are public).
const redact = (s) => { let o = String(s); for (const sec of [GOOGLE_API_KEY, KEY]) if (sec) o = o.split(sec).join('***'); return o; };

// ---- args ----
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = has('--apply');
const ALL = has('--all');
const LIMIT = parseInt(val('--limit', ALL ? '100000' : '12'), 10); // daily batch size
const CURRENCY = val('--currency', 'EUR');
const LOCALE = val('--locale', 'EN');                          // LocaleEnum
const CATEGORY_ID = val('--category-id', 'Q2F0ZWdvcnkvMjM');   // "Art"
const LICENSE_CODE = val('--license-code', 'cults_cu');        // CULTS CU - Commercial Use
const VISIBILITY = val('--visibility', 'PUBLIC');              // PUBLIC | SECRET | DEACTIVATED
const USAGES = ['3dp', 'cnc_laser'];                           // 3D printing + CNC machining / laser cutting
const PRICE_FLAG = val('--price', '');                         // optional explicit price override
const PRICE_OPTIONS = [4.99, 5.99];                            // randomly assigned per listing (looks organic)
const JITTER_MIN = parseInt(val('--jitter', '0'), 10);         // sleep 0..N random minutes before posting (human-like)
const MAX_TAGS = 12;
const LEDGER_PATH = 'cults3d_uploaded.json';
const PREVIEW_PATH = 'cults3d-upload-preview.json';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function authHeader() {
  if (!USER || !KEY) throw new Error('Set CULTS3D_USERNAME and CULTS3D_API_KEY in .env first.');
  return 'Basic ' + Buffer.from(`${USER}:${KEY}`).toString('base64');
}

// A browser-like User-Agent + Accept headers make Cloudflare far less likely to
// serve an anti-bot 403 to shared cloud IPs (GitHub Actions runners), which was
// intermittently blocking the daily job while local (residential-IP) runs worked.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function gql(query, variables = {}) {
  let lastStatus = 0, lastText = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2500 * attempt + Math.floor(Math.random() * 2000)); // backoff before retry
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': UA,
        authorization: authHeader(),
      },
      body: JSON.stringify({ query, variables }),
    });
    lastStatus = res.status;
    lastText = await res.text();
    let json;
    try { json = JSON.parse(lastText); }
    catch {
      // Non-JSON body = an anti-bot / Cloudflare block page. Retry transient blocks.
      if (attempt < 3 && (res.status === 403 || res.status === 429 || res.status >= 500)) {
        console.log(`  (Cults ${res.status} block — retry ${attempt + 1}/3 after backoff)`);
        continue;
      }
      throw new Error(`Non-JSON response (${res.status}): ${lastText.slice(0, 300)}`);
    }
    if (json.errors) throw new Error('GraphQL errors: ' + JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error(`Non-JSON response (${lastStatus}): ${String(lastText).slice(0, 300)}`);
}

const driveId = (link) => {
  const m = String(link || '').match(/[?&]id=([^&]+)/) || String(link || '').match(/\/d\/([^/]+)/);
  return m ? m[1] : null;
};

// Build a Cults3D-ingestable file URL. Plain Drive download links fail for files
// >100MB (virus-scan interstitial), so when a Google API key is set we use the
// Drive API media endpoint, which streams raw bytes at any size. The &filename=
// suffix gives Cults the .stl extension to detect (Google also sends it via
// Content-Disposition).
function driveFileUrl(id, filename) {
  const name = encodeURIComponent(filename || `${id}.stl`);
  if (GOOGLE_API_KEY) return `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${GOOGLE_API_KEY}&filename=${name}`;
  return `https://drive.usercontent.com/download?id=${id}&export=download&confirm=t&filename=${name}`;
}

async function fetchProducts() {
  const ledger = existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) : {};
  const done = new Set(Object.keys(ledger));
  const rows = [];
  const q = db.from('products')
    .select('id, slug, title, seo_title, seo_description, description, seo_keywords, price_usd, image_url, gallery, is_bestseller, is_bundle, cults3d_file_name')
    .eq('active', true).not('image_url', 'is', null)
    .is('cults3d_uploaded_at', null)                            // DB tracking: skip already-uploaded
    .order('is_bestseller', { ascending: false }).order('slug'); // bestsellers first, then the rest
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  // Exclude bundles (and the local ledger as a belt-and-suspenders guard).
  return { products: rows.filter((p) => !done.has(p.id) && p.is_bundle !== true), ledger };
}

async function fetchDownloadMap(ids) {
  const map = {};
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data } = await db.from('product_downloads').select('product_id, download_link').in('product_id', slice);
    for (const r of data || []) if (!map[r.product_id]) map[r.product_id] = r.download_link;
  }
  return map;
}

function buildPayload(p, downloadLink, driveMap) {
  const id = driveId(downloadLink);
  const drive = id ? driveMap[id] : null;
  const filename = p.cults3d_file_name || drive?.name || (id ? `${p.slug}.stl` : null);
  const images = [p.image_url, ...(Array.isArray(p.gallery) ? p.gallery : [])]
    .filter((u) => typeof u === 'string' && u.startsWith('http'));
  const uniqueImages = [...new Set(images)].slice(0, 10);
  // Cults3D caps total tag characters at 300. Budget conservatively (count a
  // 2-char separator per tag, plus margin) and cap the count.
  const tags = [];
  let tagChars = 0;
  for (const raw of (Array.isArray(p.seo_keywords) ? p.seo_keywords : [])) {
    const t = String(raw).trim();
    if (!t || t.length > 40) continue;
    if (tags.length >= MAX_TAGS || tagChars + t.length + 2 > 270) break;
    tags.push(t); tagChars += t.length + 2;
  }
  const price = PRICE_FLAG ? Number(PRICE_FLAG) : PRICE_OPTIONS[Math.floor(Math.random() * PRICE_OPTIONS.length)];
  const description = (p.description || p.seo_description || '').trim()
    + `\n\nInstant download with commercial use included. Browse the full collection at ${SITE}`;
  return {
    productId: p.id,
    slug: p.slug,
    name: (p.seo_title || p.title || '').split('|')[0].trim().slice(0, 100),
    description: description.slice(0, 4000),
    tagNames: tags,
    imageUrls: uniqueImages,
    fileUrls: id ? [driveFileUrl(id, filename)] : [],
    downloadPrice: Number.isFinite(price) ? Math.round(price * 100) / 100 : null,
    currency: CURRENCY,
    _driveFileId: id,
    _driveFileName: filename,
    _driveSizeMB: drive?.size ? Math.round(Number(drive.size) / 1e6) : null,
  };
}

const CREATE_MUTATION = `
mutation Create($name:String!,$description:String!,$imageUrls:[String!]!,$fileUrls:[String!]!,$locale:LocaleEnum!,$categoryId:ID!,$downloadPrice:Float,$currency:CurrencyEnum,$licenseCode:String,$tagNames:[String!],$usages:[String!],$visibility:CreationVisibilityEnum){
  createCreation(name:$name, description:$description, imageUrls:$imageUrls, fileUrls:$fileUrls, locale:$locale, categoryId:$categoryId, downloadPrice:$downloadPrice, currency:$currency, licenseCode:$licenseCode, tagNames:$tagNames, usages:$usages, visibility:$visibility, madeWithAi:false){
    creation { id url(locale:$locale) }
    errors
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch each image, dedup by content hash (catches the same image saved under
// different filenames, e.g. main == gallery[0]), and warm the CDN at the same time.
async function distinctImages(urls) {
  const seen = new Set(), out = [];
  for (const u of urls.slice(0, 12)) {
    try {
      const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
      const h = createHash('sha1').update(buf).digest('hex');
      if (!seen.has(h)) { seen.add(h); out.push(u); }
    } catch { if (!out.includes(u)) out.push(u); }
  }
  return out.slice(0, 10);
}

async function warm(urls) {
  await Promise.all(urls.map((u) => fetch(u).then((r) => r.arrayBuffer()).catch(() => {})));
}

async function createOnce(pl, imageUrls) {
  const data = await gql(CREATE_MUTATION, {
    name: pl.name, description: pl.description, imageUrls, fileUrls: pl.fileUrls,
    locale: LOCALE, categoryId: CATEGORY_ID, downloadPrice: pl.downloadPrice, currency: pl.currency,
    licenseCode: LICENSE_CODE, tagNames: pl.tagNames, usages: USAGES, visibility: VISIBILITY,
  });
  return data.createCreation;
}

// Cults3D intermittently times out fetching several images at once. Bias toward
// keeping ALL distinct images: retry the full set several times (warming each
// time), then drop images one at a time only as a last resort. Failed attempts
// don't create a listing, so retrying is safe; images can't be added later.
async function createListing(pl) {
  const imgs = await distinctImages(pl.imageUrls);
  const plan = [imgs, imgs, imgs, imgs];                        // 4 tries at the full set
  for (let drop = 1; drop < imgs.length; drop++) plan.push(imgs.slice(0, imgs.length - drop));
  let last;
  for (const set of plan) {
    if (!set.length) continue;
    await warm(set);
    try {
      const r = await createOnce(pl, set);
      if (!r.errors || !r.errors.length) return { ok: true, creation: r.creation, images: set.length };
      last = r.errors;
      if (!r.errors.some((e) => /could not download/i.test(JSON.stringify(e)))) return { ok: false, errors: r.errors };
      await sleep(2500); // transient image fetch -> retry
    } catch (e) { last = e.message; await sleep(2500); }
  }
  return { ok: false, errors: last };
}

async function main() {
  // --- diagnostic modes (need key) ---
  if (has('--introspect')) {
    const d = await gql(`{ __type(name:"Mutation"){ fields(includeDeprecated:true){ name args{ name type{ kind name ofType{ kind name ofType{ kind name } } } } } } }`);
    const f = d.__type.fields.find((x) => x.name === 'createCreation');
    console.log('createCreation args:\n', JSON.stringify(f, null, 2));
    return;
  }
  if (has('--list-categories')) {
    const d = await gql(`{ categories { id name } }`).catch(async () => gql(`{ creationCategories { id name } }`));
    console.log(JSON.stringify(d, null, 2));
    return;
  }
  if (has('--list-licenses')) {
    const d = await gql(`{ licenses { code name } }`).catch(() => ({ note: 'licenses query name differs; run --introspect on Query type' }));
    console.log(JSON.stringify(d, null, 2));
    return;
  }

  const { products, ledger } = await fetchProducts();
  // Resolve download links + Drive files for the ENTIRE unpublished candidate set (not just the
  // first LIMIT), then filter to publishable rows BEFORE slicing. This makes the job SKIP no-file
  // rows (memberships, BUNDLE-MANUAL) instead of head-of-line blocking on them: previously
  // `products.slice(0, LIMIT)` grabbed the first candidate even if it had no STL, so a single
  // file-less product at the top of the order (e.g. a bestseller membership) stalled the whole
  // rollout — every run re-picked it and published nothing. fetchDownloadMap paginates and
  // buildPayload is in-memory, so scanning all candidates each run is cheap.
  const dlMap = await fetchDownloadMap(products.map((p) => p.id));
  const driveRaw = existsSync('drive_stls.json') ? JSON.parse(readFileSync('drive_stls.json', 'utf8')) : [];
  const driveArr = Array.isArray(driveRaw) ? driveRaw : (driveRaw.files || Object.values(driveRaw));
  const driveMap = Object.fromEntries(driveArr.filter((f) => f && f.id).map((f) => [f.id, f]));

  const allPayloads = products.map((p) => buildPayload(p, dlMap[p.id], driveMap));
  const publishable = allPayloads.filter((x) => x.fileUrls.length && x.imageUrls.length);
  const noFile = allPayloads.filter((x) => !x.fileUrls.length);
  const ready = publishable.slice(0, LIMIT);

  console.log(`Unpublished: ${products.length} | publishable: ${publishable.length} | no-file (skipped): ${noFile.length} | posting this run: ${ready.length}`);
  if (noFile.length) console.log('  no-file slugs (skipped):', noFile.slice(0, 15).map((x) => x.slug).join(', ') + (noFile.length > 15 ? ` …+${noFile.length - 15} more` : ''));

  if (!APPLY) {
    writeFileSync(PREVIEW_PATH, redact(JSON.stringify(ready, null, 2)));
    console.log(`\nDRY RUN — wrote ${ready.length} payload(s) that WOULD post to ${PREVIEW_PATH}. Review, then run with --apply.`);
    console.log('\nFirst payload preview:\n', redact(JSON.stringify(ready[0], null, 2)));
    return;
  }

  // --- live ---
  if (!CATEGORY_ID || !LICENSE_CODE) {
    console.error('Live mode needs --category-id <ID> and --license-code <CODE>. Run --list-categories / --list-licenses first.');
    process.exit(1);
  }
  // Human-like pacing: optional random delay before posting this run's listing(s).
  if (JITTER_MIN > 0) {
    const ms = Math.floor(Math.random() * JITTER_MIN * 60000);
    console.log(`Jitter: waiting ${Math.round(ms / 60000)} min before posting...`);
    await sleep(ms);
  }
  // Pre-flight: verify we can WRITE to the DB before creating anything on Cults.
  // (Cults has no delete — an untracked listing would be re-created = duplicate.
  //  This catches a wrong/anon SUPABASE_SERVICE_ROLE_KEY, which can still read.)
  if (ready[0]) {
    const { error } = await db.from('products')
      .update({ cults3d_uploaded_at: null }).eq('id', ready[0].productId).is('cults3d_uploaded_at', null);
    if (error) { console.error('ABORT: cannot write to DB (check SUPABASE_SERVICE_ROLE_KEY has service-role/write access):', error.message); process.exit(1); }
  }

  let ok = 0, fail = 0;
  for (const pl of ready) {
    const res = await createListing(pl);
    if (res.ok) {
      // Mark in DB FIRST and HALT if it fails — never leave a Cults listing untracked.
      const { error: upErr } = await db.from('products')
        .update({ cults3d_url: res.creation.url, cults3d_uploaded_at: new Date().toISOString() }).eq('id', pl.productId);
      if (upErr) { console.error(`ABORT: created ${res.creation.url} but DB update failed — fix tracking before re-running:`, upErr.message); process.exit(1); }
      ok++;
      ledger[pl.productId] = { id: res.creation.id, url: res.creation.url, images: res.images, at: new Date().toISOString() };
      try { writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2)); } catch {}
      console.log(`✓ ${pl.slug} (${res.images} img) -> ${res.creation.url}`);
    } else { fail++; console.log(`✗ ${pl.slug}: ${redact(JSON.stringify(res.errors))}`); }
    await sleep(800); // stay well under 60 req / 30s
  }
  console.log(`\nDone. Created ${ok}, failed ${fail}.`);
  if (fail > 0 && ok === 0) process.exit(1); // surface a red CI run when nothing succeeded
}

main().catch((e) => { console.error(redact((e && e.stack) || e)); process.exit(1); });
