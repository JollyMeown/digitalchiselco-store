// Pull current title / tags / description for every WEAK listing so the
// rewrite has the real live copy to work from (and so it can be reverted).
import fs from 'node:fs';
import { etsy } from 'file:///D:/000%20DIGITAL%20CHISEL%20WEBSITE/scripts/etsy_client.mjs';
import { fileURLToPath } from 'node:url';
const S = fileURLToPath(new URL('.', import.meta.url)).replace(/[\/]$/, '');
const W = JSON.parse(fs.readFileSync(`${S}/etsy_weak.json`, 'utf8'));
const out = [];
let i = 0;
for (const w of W.weak) {
  try {
    const l = await etsy(`/listings/${w.listing_id}`, { oauth: true });
    out.push({ listing_id: w.listing_id, title: l.title, tags: l.tags || [], description: (l.description || '').slice(0, 1500), views: w.views, favorers: w.favorers, sales: w.sales, taxonomy_id: l.taxonomy_id, state: l.state });
  } catch (e) { out.push({ listing_id: w.listing_id, error: e.message.slice(0, 100), views: w.views }); }
  if (++i % 50 === 0) console.log(i, '/', W.weak.length);
  await new Promise((r) => setTimeout(r, 220));
}
fs.writeFileSync(`${S}/etsy_weak_full.json`, JSON.stringify(out, null, 1));
console.log('fetched', out.filter((o) => !o.error).length, 'ok,', out.filter((o) => o.error).length, 'errors');
