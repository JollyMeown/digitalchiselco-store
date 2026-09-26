// Copycat Watch (2026-09-26, owner: "can we check anyone stealing images?").
//
// For our best-selling designs, search Etsy the way a buyer would, then
// compare every other shop's listing pictures with our own pictures of that
// design. A reused picture is the clearest sign of a copied listing: a thief
// uploads our render or mockup, maybe resized or recompressed. A 64-bit
// difference hash (dHash) survives resizing and compression, so a distance of
// 8 bits or less out of 64 means "the same picture". A title copied word for
// word is recorded too, as the weaker signal.
//
// Runs a slice of the top designs each night (growth step 'copycatWatch'),
// oldest-checked first, so the whole list is covered about every 5 days
// without eating the nightly time budget; Admin > Copycat Watch can check a
// few now. Our own shops are never reported.
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';

const OUR_SHOP_ID = 61524055;                     // DigitalChiselCo on Etsy
const OUR_SHOP_NAMES = ['DigitalChiselCo', 'CustomReliefCo'];
export const WATCH_TOP = 75;                      // designs watched: the best sellers
export const IMAGE_MATCH_MAX = 8;                 // dHash bits (of 64) for "same picture"
export const TITLE_MATCH_MIN = 0.8;               // share of meaningful title words in common
const SEARCH_LIMIT = 25;
const OUR_PICS = 5;                               // our pictures compared per design
const THEIR_PICS = 3;                             // their pictures compared per listing

const env = (n: string) => (typeof process !== 'undefined' ? process.env[n] : undefined) ?? (import.meta as any).env?.[n];
function etsyKey(): string {
  const k = String(env('ETSY_API_KEY') || '');
  const s = String(env('ETSY_SHARED_SECRET') || '');
  return k.includes(':') ? k : s ? `${k}:${s}` : k;
}
async function etsy(path: string): Promise<any> {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(`https://openapi.etsy.com/v3/application${path}`, { headers: { 'x-api-key': etsyKey() } });
    if (r.status === 429) { await new Promise((z) => setTimeout(z, 1500 * (t + 1))); continue; }
    if (!r.ok) throw new Error(`Etsy ${r.status} on ${path.split('?')[0]}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  }
  throw new Error('Etsy rate limit');
}

const STOP = new Set(['stl', 'file', 'files', 'cnc', 'relief', 'bas', '3d', 'carving', 'carved', 'wood', 'wooden', 'router', 'for', 'and', 'the', 'with', 'a', 'of', 'in', 'on', 'design', 'designs', 'wall', 'art', 'model', 'printing', 'print', 'printer', 'digital', 'download', 'instant', 'scene', 'panel', 'decor', 'laser', 'engraving', 'vcarve', 'aspire', 'artcam']);
export const titleWords = (t: string) => new Set(String(t || '').split('|')[0].toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const w of a) if (b.has(w)) n++;
  return n / Math.max(a.size, b.size);
}

/** 64-bit difference hash of a picture, as a BigInt. */
export async function dHash(buf: Buffer): Promise<bigint> {
  const px = await sharp(buf).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return h;
}
export function hamming(a: bigint, b: bigint): number { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; }
async function hashUrl(url: string): Promise<bigint | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await dHash(Buffer.from(await r.arrayBuffer()));
  } catch { return null; }
}
const small = (u: string) => u.includes('/storage/v1/object/public/') ? u.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=240&resize=contain&quality=70' : u;

export type CopycatRun = { checked: number; listingsSeen: number; newMatches: number; errors: string[] };

/** Check the `limit` watched designs that were checked longest ago. */
export async function runCopycatBatch(db: SupabaseClient, opts: { limit?: number; deadlineMs?: number } = {}): Promise<CopycatRun> {
  const out: CopycatRun = { checked: 0, listingsSeen: 0, newMatches: 0, errors: [] };
  if (!etsyKey()) { out.errors.push('ETSY_API_KEY is not set'); return out; }
  const deadline = opts.deadlineMs ? Date.now() + opts.deadlineMs : Infinity;

  const { data: top } = await db.from('products')
    .select('id, title, image_url, gallery, etsy_sales_365')
    .eq('active', true).or('is_bundle.is.null,is_bundle.eq.false').is('membership_plan_slug', null)
    .gt('etsy_sales_365', 0).order('etsy_sales_365', { ascending: false }).limit(WATCH_TOP);
  const { data: checks } = await db.from('copycat_checks').select('product_id, checked_at');
  const last = new Map((checks || []).map((c: any) => [c.product_id, Date.parse(c.checked_at)]));
  const queue = [...(top || [])].sort((a: any, b: any) => (last.get(a.id) || 0) - (last.get(b.id) || 0)).slice(0, opts.limit ?? 15);

  for (const p of queue as any[]) {
    if (Date.now() > deadline) break;
    try {
      const ours = [p.image_url, ...(Array.isArray(p.gallery) ? p.gallery : [])].filter(Boolean).filter((u: string, i: number, a: string[]) => a.indexOf(u) === i).slice(0, OUR_PICS);
      const ourHashes = (await Promise.all(ours.map((u: string) => hashUrl(small(u))))).filter((h): h is bigint => h !== null);
      const ourWords = titleWords(p.title);
      const kw = [...ourWords].slice(0, 6).join(' ') + ' stl';
      const found = await etsy(`/listings/active?keywords=${encodeURIComponent(kw)}&limit=${SEARCH_LIMIT}&sort_on=score`);
      const cand = (found.results || []).filter((l: any) => l.shop_id !== OUR_SHOP_ID);
      out.listingsSeen += cand.length;
      let matches = 0;
      if (cand.length) {
        const batch = await etsy(`/listings/batch?listing_ids=${cand.map((l: any) => l.listing_id).join(',')}&includes=Images,Shop`);
        for (const l of batch.results || []) {
          const shopName = l.shop?.shop_name || '';
          if (l.shop_id === OUR_SHOP_ID || OUR_SHOP_NAMES.includes(shopName)) continue;
          const imgs = (l.images || []).sort((a: any, b: any) => (a.rank || 0) - (b.rank || 0)).slice(0, THEIR_PICS);
          let best = 64;
          for (const im of imgs) {
            const h = await hashUrl(im.url_570xN || im.url_170x135);   // full shape, not the cropped thumbnail
            if (h === null) continue;
            for (const o of ourHashes) best = Math.min(best, hamming(h, o));
          }
          const tOver = overlap(ourWords, titleWords(l.title));
          const kind = best <= IMAGE_MATCH_MAX ? 'image' : tOver >= TITLE_MATCH_MIN ? 'title' : null;
          if (!kind) continue;
          matches++;
          const row = {
            product_id: p.id, etsy_listing_id: l.listing_id, shop_id: l.shop_id, shop_name: shopName || null,
            title: String(l.title || '').slice(0, 300), url: l.url || `https://www.etsy.com/listing/${l.listing_id}`,
            image_url: imgs[0]?.url_570xN || imgs[0]?.url_170x135 || null,
            price: l.price ? `${(l.price.amount / l.price.divisor).toFixed(2)} ${l.price.currency_code}` : null,
            image_distance: best, title_overlap: Math.round(tOver * 100) / 100, kind, last_seen: new Date().toISOString(),
          };
          const { data: existing } = await db.from('copycat_matches').select('id').eq('product_id', p.id).eq('etsy_listing_id', l.listing_id).maybeSingle();
          if (existing) await db.from('copycat_matches').update(row).eq('id', existing.id);
          else { await db.from('copycat_matches').insert(row); out.newMatches++; }
        }
      }
      await db.from('copycat_checks').upsert({ product_id: p.id, checked_at: new Date().toISOString(), results: cand.length, matches });
      out.checked++;
    } catch (e: any) {
      out.errors.push(`${String(p.title).split('|')[0].slice(0, 40)}: ${e?.message || e}`);
      if (/Etsy (401|403)/.test(String(e?.message))) break;   // bad key: stop, do not hammer
    }
  }
  return out;
}
