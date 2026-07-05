// Automated Pinterest publisher (Pinterest API v5).
//
// Creates Pins that link to our product pages, built entirely from data we
// already have:
//   - title/description -> products.seo_title / seo_description / description
//   - image             -> products.image_url (Pinterest fetches it by URL)
//   - destination link  -> https://digitalchiselco.com/product/<slug>
//
// Replaces Pinterest's unreliable native "auto-publish from RSS" feature with a
// publisher we fully control, on the same stateless cron + DB-tracking pattern
// as the Cults3D uploader. Tracking columns: products.pinterest_posted_at /
// pinterest_pin_id (migration 026) — so runs never re-pin a product.
//
// Auth (OAuth 2.0): create an app at https://developers.pinterest.com/apps/,
// then run `node scripts/pinterest_oauth.mjs` once to mint a refresh token.
// Set in .env AND in GitHub repo secrets:
//   PINTEREST_APP_ID=...
//   PINTEREST_APP_SECRET=...
//   PINTEREST_REFRESH_TOKEN=...        # from pinterest_oauth.mjs (valid ~1 year)
//   PINTEREST_BOARD_ID=...             # find via: node scripts/pinterest_publish.mjs --list-boards
// The publisher mints a short-lived access token from the refresh token each run.
//
// Usage:
//   node scripts/pinterest_publish.mjs                 # DRY RUN — writes pinterest-publish-preview.json
//   node scripts/pinterest_publish.mjs --limit 3       # dry run, first 3
//   node scripts/pinterest_publish.mjs --list-boards   # print your board ids (needs token)
//   node scripts/pinterest_publish.mjs --apply --limit 1 --jitter 30   # LIVE: create 1 pin
//
// Idempotent via the DB (pinterest_posted_at); safe to run repeatedly.

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SITE = process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
const API = 'https://api.pinterest.com/v5';
const APP_ID = process.env.PINTEREST_APP_ID || '';
const APP_SECRET = process.env.PINTEREST_APP_SECRET || '';
const REFRESH_TOKEN = process.env.PINTEREST_REFRESH_TOKEN || '';

// ---- args ----
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = has('--apply');
const LIMIT = parseInt(val('--limit', '12'), 10);
const JITTER_MIN = parseInt(val('--jitter', '0'), 10);
const BOARD_ID = process.env.PINTEREST_BOARD_ID || val('--board-id', '');
const PREVIEW_PATH = 'pinterest-publish-preview.json';

// Strip secrets from anything we log (the repo + Actions logs are public).
const redact = (s) => { let o = String(s); for (const sec of [APP_SECRET, REFRESH_TOKEN]) if (sec) o = o.split(sec).join('***'); return o; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Exchange the long-lived refresh token for a short-lived access token.
async function getAccessToken() {
  if (!APP_ID || !APP_SECRET || !REFRESH_TOKEN) {
    throw new Error('Set PINTEREST_APP_ID, PINTEREST_APP_SECRET and PINTEREST_REFRESH_TOKEN first.');
  }
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }).toString(),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`Token: non-JSON (${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok || !json.access_token) throw new Error(`Token exchange failed (${res.status}): ${redact(JSON.stringify(json)).slice(0, 300)}`);
  return json.access_token;
}

async function listBoards(token) {
  const res = await fetch(`${API}/boards?page_size=100`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`List boards failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  return json.items || [];
}

async function fetchProducts() {
  const rows = [];
  const q = db.from('products')
    .select('id, slug, title, seo_title, seo_description, description, seo_keywords, image_url, gallery, image_alt, is_bestseller, is_bundle')
    .eq('active', true).not('image_url', 'is', null)
    .is('pinterest_posted_at', null)                              // DB tracking: skip already-pinned
    .order('is_bestseller', { ascending: false }).order('slug'); // bestsellers first, then the rest
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows.filter((p) => p.is_bundle !== true);
}

function buildPin(p) {
  const title = (p.seo_title || p.title || '').split('|')[0].trim().slice(0, 100);
  const kws = (Array.isArray(p.seo_keywords) ? p.seo_keywords : []).map((k) => String(k).trim()).filter(Boolean);
  const hashtags = kws.slice(0, 4)
    .map((k) => '#' + k.replace(/[^a-z0-9]+/gi, ''))
    .filter((h) => h.length > 2)
    .join(' ');
  const cta = ' Instant download, commercial use. Free 5-file STL pack at digitalchiselco.com/free.';
  let body = (p.seo_description || p.description || '').replace(/\s+/g, ' ').trim();
  const room = 800 - cta.length - (hashtags ? hashtags.length + 1 : 0);
  if (body.length > room) body = body.slice(0, Math.max(0, room - 1)).trim() + '…';
  const description = (body + cta + (hashtags ? ' ' + hashtags : '')).slice(0, 800);
  const image = [p.image_url, ...(Array.isArray(p.gallery) ? p.gallery : [])]
    .find((u) => typeof u === 'string' && u.startsWith('http'));
  return {
    productId: p.id,
    slug: p.slug,
    title,
    description,
    link: `${SITE}/product/${p.slug}`,
    altText: (p.image_alt || title).slice(0, 500),
    imageUrl: image || null,
  };
}

async function createPin(token, pin) {
  const res = await fetch(`${API}/pins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_id: BOARD_ID,
      title: pin.title,
      description: pin.description,
      link: pin.link,
      alt_text: pin.altText,
      media_source: { source_type: 'image_url', url: pin.imageUrl },
    }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { return { ok: false, error: `Non-JSON (${res.status}): ${text.slice(0, 300)}` }; }
  if (!res.ok || !json.id) return { ok: false, error: `${res.status}: ${JSON.stringify(json).slice(0, 300)}` };
  return { ok: true, id: json.id };
}

async function main() {
  // Find the destination board id (run this once after minting the token).
  if (has('--list-boards')) {
    const token = await getAccessToken();
    const boards = await listBoards(token);
    console.log('Your boards (copy the id of the target board into PINTEREST_BOARD_ID):');
    for (const b of boards) console.log(`  ${b.id}  ${b.name}`);
    if (!boards.length) console.log('  (none found — create a board on Pinterest first)');
    return;
  }

  // Green no-op until the account is configured, so scheduled runs don't spam
  // failure emails before the secrets are added.
  if (APPLY && (!APP_ID || !APP_SECRET || !REFRESH_TOKEN || !BOARD_ID)) {
    console.log('Pinterest not configured yet (missing PINTEREST_APP_ID / APP_SECRET / REFRESH_TOKEN / BOARD_ID). Skipping — no-op.');
    return;
  }

  const products = await fetchProducts();
  const pins = products.map(buildPin).filter((x) => x.imageUrl); // every product has an image, but guard anyway
  const ready = pins.slice(0, LIMIT);
  console.log(`Unpublished: ${products.length} | ready: ${pins.length} | posting this run: ${ready.length}`);

  if (!APPLY) {
    writeFileSync(PREVIEW_PATH, JSON.stringify(ready, null, 2));
    console.log(`\nDRY RUN — wrote ${ready.length} pin(s) that WOULD post to ${PREVIEW_PATH}.`);
    if (ready[0]) console.log('\nFirst pin preview:\n', JSON.stringify(ready[0], null, 2));
    return;
  }

  const token = await getAccessToken();

  // Human-like pacing: optional random delay before posting this run's pin(s).
  if (JITTER_MIN > 0) {
    const ms = Math.floor(Math.random() * JITTER_MIN * 60000);
    console.log(`Jitter: waiting ${Math.round(ms / 60000)} min before posting...`);
    await sleep(ms);
  }

  // Pre-flight: verify we can WRITE to the DB before creating anything on Pinterest.
  // (Catches a wrong/anon SUPABASE_SERVICE_ROLE_KEY, which can still read — an
  //  untracked pin would otherwise be re-created next run = duplicate.)
  if (ready[0]) {
    const { error } = await db.from('products')
      .update({ pinterest_posted_at: null }).eq('id', ready[0].productId).is('pinterest_posted_at', null);
    if (error) { console.error('ABORT: cannot write to DB (check SUPABASE_SERVICE_ROLE_KEY has service-role/write access):', error.message); process.exit(1); }
  }

  let ok = 0, fail = 0;
  for (const pin of ready) {
    const res = await createPin(token, pin);
    if (res.ok) {
      // Mark in DB FIRST and HALT if it fails — never leave a pin untracked.
      const { error: upErr } = await db.from('products')
        .update({ pinterest_pin_id: res.id, pinterest_posted_at: new Date().toISOString() }).eq('id', pin.productId);
      if (upErr) { console.error(`ABORT: created pin ${res.id} but DB update failed — fix tracking before re-running:`, upErr.message); process.exit(1); }
      ok++;
      console.log(`✓ ${pin.slug} -> pin ${res.id}`);
    } else { fail++; console.log(`✗ ${pin.slug}: ${redact(res.error)}`); }
    await sleep(1500); // gentle pacing, well under Pinterest's rate limits
  }
  console.log(`\nDone. Created ${ok}, failed ${fail}.`);
  if (fail > 0 && ok === 0) process.exit(1); // red CI run only when nothing succeeded
}

main().catch((e) => { console.error(redact((e && e.stack) || String(e))); process.exit(1); });
