// Scrape full description + image gallery from the live website /product pages -> Supabase.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import pg from 'pg';

const rows = parse(readFileSync('D:/MOBILE WEBSITE/products_master.csv'), { columns: true, skip_empty_lines: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

function extract(html) {
  // description
  const m = html.match(/product-desc__body"[^>]*>([\s\S]*?)(?:<h2|<\/section>)/i);
  let desc = m ? m[1] : '';
  desc = desc.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  // gallery (dedupe by image id, prefer 794xN)
  const seen = new Set(); const gallery = [];
  for (const mm of html.matchAll(/https:\/\/i\.etsystatic\.com\/61524055\/r\/il\/[a-z0-9]+\/(\d+)\/il_\d+x\d+\.\d+_[a-z0-9]+\.jpg/gi)) {
    const id = mm[1];
    if (!seen.has(id)) { seen.add(id); gallery.push(mm[0].replace(/il_\d+x\d+/, 'il_794xN')); }
  }
  return { desc, gallery };
}

let ok = 0, fail = 0, i = 0;
for (const r of rows) {
  i++;
  const url = 'https://digitalchiselco.com' + r.product_url;
  try {
    const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then((x) => x.text());
    const { desc, gallery } = extract(html);
    if (gallery.length || desc) {
      await db.query(
        `update products set description = coalesce(nullif($1,''), description),
           gallery = $2::jsonb,
           image_url = coalesce(nullif(image_url,''), $3)
         where etsy_listing_id = $4`,
        [desc, JSON.stringify(gallery), gallery[0] || null, r.etsy_listing_id]
      );
      ok++;
    } else { fail++; }
  } catch (e) { fail++; }
  if (i % 100 === 0) console.log(`${i}/${rows.length} | enriched ${ok} | empty/fail ${fail}`);
  await new Promise((res) => setTimeout(res, 120));
}
await db.end();
console.log(`DONE. enriched ${ok}, failed/empty ${fail}, of ${rows.length}`);
