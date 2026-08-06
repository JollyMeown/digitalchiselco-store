// Enumerates the digital files attached to every active Etsy listing
// (getAllListingFiles, OAuth listings_r) → etsy_listing_files.json
// { "<listing_id>": [{ listing_file_id, filename, size_bytes, filetype }] }
//
// Paced at ~4 req/s to stay well under the 10 QPS app limit.
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { etsy } from './etsy_client.mjs';

const SHOP_ID = 61524055;
const OUT = 'etsy_listing_files.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// resume support — skip listings already captured
const result = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

const ids = [];
for (let offset = 0; ; offset += 100) {
  const page = await etsy(`/shops/${SHOP_ID}/listings?state=active&limit=100&offset=${offset}`, { oauth: true });
  ids.push(...(page.results || []).map((l) => l.listing_id));
  if (ids.length >= page.count || !(page.results || []).length) break;
}
console.log(`Listings: ${ids.length}, already captured: ${Object.keys(result).length}`);

let n = 0, errs = 0;
for (const id of ids) {
  n++;
  if (result[id]) continue;
  try {
    const files = await etsy(`/shops/${SHOP_ID}/listings/${id}/files`, { oauth: true });
    result[id] = (files.results || []).map((f) => ({
      listing_file_id: f.listing_file_id,
      filename: f.filename,
      size_bytes: f.size_bytes ?? f.filesize,
      filetype: f.filetype,
    }));
  } catch (e) {
    errs++;
    console.log(`ERR ${id}: ${e.message.slice(0, 120)}`);
    if (errs > 30) { console.log('Too many errors — saving progress and stopping.'); break; }
  }
  if (n % 50 === 0) { writeFileSync(OUT, JSON.stringify(result)); console.log(`...${n}/${ids.length}`); }
  await sleep(250);
}
writeFileSync(OUT, JSON.stringify(result));
console.log(`Done. ${Object.keys(result).length} listings captured, ${errs} errors → ${OUT}`);
