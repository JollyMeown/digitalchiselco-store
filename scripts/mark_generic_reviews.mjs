// Flags reviews.generic for the product-page social-proof pool:
//   5-star + English (ascii) + reasonable length + does NOT name a specific
//   design (so a rose review never appears under an eagle product).
// Re-runnable: recomputes every flag each time.
//   node scripts/mark_generic_reviews.mjs [--apply]
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

// nouns that tie a review to one design family
const SPECIFIC = /\b(rose|flower|floral|eagle|flag|deer|owl|dragon|cross|skull|tray|platter|clock|map|horse|lion|wolf|bear|fish|bass|duck|mallard|car|truck|tractor|train|plane|guitar|jesus|christ|angel|heart|turtle|whale|crab|lobster|cardinal|hummingbird|dog|puppy|cat|moose|elk|sheep|pig|chicken|rooster|farm|barn|kraken|octopus|mermaid|tree of life|celtic|viking|santa|christmas)\b/i;
// ascii-only but non-English (es/pt/it/de stopwords), other sellers' names,
// and hedged praise that reads negative on a sales page
const NON_ENGLISH = /\b(el|la|es|muy|una|di|che|mai|avrei|und|sehr|der|die|das|nicht|gerne|waren|muito|com|para|arquivo|archivo|excelente|bueno|bonito|madera|gostei|qualidade|datei)\b/i;
const OTHER_SELLER = /\b(oleg)\b/i;
const HEDGED = /\b(could be|could have|wish it|but overall|however|although|a little (too|deeper|shallow))\b/i;

const { data: revs, error } = await db.from('reviews').select('id, name, text, rating, active');
if (error) throw error;

let on = 0, off = 0;
for (const r of revs || []) {
  let t = String(r.text || '').trim();
  // decode the HTML entities Etsy exports (&#39; etc.) so pages never show them raw
  const decoded = t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const generic =
    r.active !== false &&
    Number(r.rating) === 5 &&
    decoded.length >= 25 && decoded.length <= 300 &&
    !/[^\x00-\x7F]/.test(decoded) &&
    !SPECIFIC.test(decoded) &&
    !NON_ENGLISH.test(decoded) &&
    !OTHER_SELLER.test(decoded) &&
    !HEDGED.test(decoded);
  generic ? on++ : off++;
  if (APPLY) {
    const patch = { generic };
    if (decoded !== t) patch.text = decoded;
    await db.from('reviews').update(patch).eq('id', r.id);
  } else if (generic) console.log('generic ✓', JSON.stringify(decoded.slice(0, 90)));
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${on} generic, ${off} excluded (of ${revs?.length}).`);
