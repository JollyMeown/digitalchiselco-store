// Apply generated title + tags to LIVE Etsy listings, in batches, revertibly.
//   node etsy_apply.mjs --batch b1 --limit 40           # dry run (default)
//   node etsy_apply.mjs --batch b1 --limit 40 --apply   # live
//   node etsy_apply.mjs --revert b1                      # put batch back
// Every change is recorded in etsy_seo_experiment with the old copy and the
// views/favorers/sales at the moment of the change, which is what the admin
// panel compares against later.
// Etsy's updateListing wants application/x-www-form-urlencoded (tags as a
// comma-separated string); the website's etsy_client sends JSON, so the PATCH
// is built here directly with the same token + key helpers.
import fs from 'node:fs';
import { getAccessToken, apiKeyHeader } from 'file:///D:/000%20DIGITAL%20CHISEL%20WEBSITE/scripts/etsy_client.mjs';

import { fileURLToPath } from 'node:url';
const S = fileURLToPath(new URL('.', import.meta.url)).replace(/[\/]$/, '');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const BATCH = arg('--batch', 'b1');
const LIMIT = Number(arg('--limit', 40));
const REVERT = arg('--revert', null);

const env = fs.readFileSync('D:/000 DIGITAL CHISEL WEBSITE/.env', 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const H = { apikey: g('SUPABASE_SERVICE_ROLE_KEY'), authorization: 'Bearer ' + g('SUPABASE_SERVICE_ROLE_KEY'), 'content-type': 'application/json' };
const U = g('PUBLIC_SUPABASE_URL');
const SHOP = 61524055;

async function patchListing(id, title, tags) {
  const token = await getAccessToken();
  const r = await fetch(`https://openapi.etsy.com/v3/application/shops/${SHOP}/listings/${id}`, {
    method: 'PATCH',
    headers: { 'x-api-key': apiKeyHeader(), Authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, tags: tags.join(',') }),
  });
  if (r.status === 429) { await new Promise((res) => setTimeout(res, 5000)); return patchListing(id, title, tags); }
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

if (REVERT) {
  const rows = await fetch(`${U}/rest/v1/etsy_seo_experiment?select=*&batch=eq.${REVERT}&status=eq.applied`, { headers: H }).then((r) => r.json());
  console.log(`reverting ${rows.length} listing(s) from batch ${REVERT}${APPLY ? '' : ' (dry run)'}`);
  for (const row of rows) {
    if (!APPLY) { console.log('  would revert', row.listing_id, '->', row.old_title.slice(0, 60)); continue; }
    try {
      await patchListing(row.listing_id, row.old_title, row.old_tags);
      await fetch(`${U}/rest/v1/etsy_seo_experiment?listing_id=eq.${row.listing_id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'reverted' }) });
      console.log('  ✓ reverted', row.listing_id);
    } catch (e) { console.error('  ✗', row.listing_id, e.message); }
    await new Promise((res) => setTimeout(res, 400));
  }
  process.exit(0);
}

const proposals = JSON.parse(fs.readFileSync(`${S}/etsy_proposals.json`, 'utf8')).filter((p) => p.ok);
const already = new Set((await fetch(`${U}/rest/v1/etsy_seo_experiment?select=listing_id`, { headers: H }).then((r) => r.json())).map((r) => r.listing_id));
const todo = proposals.filter((p) => !already.has(p.listing_id)).slice(0, LIMIT);
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} batch ${BATCH}: ${todo.length} listing(s) (${already.size} already in experiment)`);

let ok = 0, fail = 0;
for (const p of todo) {
  if (!APPLY) { console.log(`  ${p.listing_id} | ${p.old_title.slice(0, 45)} -> ${p.new_title.slice(0, 60)}`); continue; }
  try {
    await patchListing(p.listing_id, p.new_title, p.tags);
    await fetch(`${U}/rest/v1/etsy_seo_experiment`, {
      method: 'POST', headers: { ...H, prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ listing_id: p.listing_id, batch: BATCH, old_title: p.old_title, old_tags: p.old_tags, new_title: p.new_title, new_tags: p.tags, views_at_apply: p.views || 0, favorers_at_apply: p.favorers || 0, sales_at_apply: p.sales || 0, status: 'applied' }),
    });
    ok++; console.log(`  ✓ ${p.listing_id} ${p.new_title.slice(0, 70)}`);
  } catch (e) {
    fail++; console.error(`  ✗ ${p.listing_id} ${e.message}`);
    await fetch(`${U}/rest/v1/etsy_seo_experiment`, { method: 'POST', headers: { ...H, prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ listing_id: p.listing_id, batch: BATCH, old_title: p.old_title, old_tags: p.old_tags, new_title: p.new_title, new_tags: p.tags, status: 'error', note: e.message.slice(0, 200) }) });
  }
  await new Promise((res) => setTimeout(res, 400));
}
if (APPLY) console.log(`\ndone: ${ok} applied, ${fail} failed. Revert with: --revert ${BATCH} --apply`);
