// One-shot cleanup: Etsy-era "📦 Delivery Instructions / DownloadLinkGoogleDrive.txt"
// blocks don't apply on the website (delivery = instant email + /account), so
// replace them with the correct wording. WEBSITE DB ONLY — Etsy listings untouched.
//
//   node scripts/clean_delivery_phrases.mjs           # dry run (default)
//   node scripts/clean_delivery_phrases.mjs --apply   # write changes
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

const REPLACEMENT = '📦 Delivery\nYour STL download links arrive by email within minutes of checkout — and stay available forever in your account at www.digitalchiselco.com/account.';

// The full block: "📦 Delivery Instructions[:]\n[Open ]DownloadLinkGoogleDrive.txt, …rest of line"
const BLOCK_RE = /📦\s*Delivery Instructions:?\s*\n\s*(?:Open (?:the )?)?DownloadLinkGoogleDrive\.txt[^\n]*/gi;
// Stray standalone mentions of the txt file outside that block
const STRAY_RE = /(?:Open (?:the )?)?DownloadLinkGoogleDrive\.txt(?:,? copy the link into your browser[^\n.]*)?/gi;

const { data: prods, error } = await db.from('products').select('id, slug, description')
  .not('description', 'is', null).limit(3000);
if (error) throw error;

let blockFixed = 0, strayFixed = 0;
const leftovers = [];
for (const p of prods) {
  let d = p.description;
  const before = d;
  if (BLOCK_RE.test(d)) { d = d.replace(BLOCK_RE, REPLACEMENT); blockFixed++; }
  BLOCK_RE.lastIndex = 0;
  if (STRAY_RE.test(d)) { d = d.replace(STRAY_RE, 'your order email'); strayFixed++; }
  STRAY_RE.lastIndex = 0;
  if (d !== before) {
    if (APPLY) {
      const { error: ue } = await db.from('products').update({ description: d }).eq('id', p.id);
      if (ue) console.error('update failed', p.slug, ue.message);
    } else {
      console.log('would fix:', p.slug.slice(0, 60));
    }
  }
  // anything else that still smells like txt-file delivery — for manual review
  if (/DownloadLinkGoogleDrive|open the txt|\.txt file with the link/i.test(d)) leftovers.push(p.slug);
}
console.log(`\n${APPLY ? 'FIXED' : 'DRY RUN'}: delivery blocks in ${blockFixed} products, stray txt mentions in ${strayFixed}.`);
if (leftovers.length) console.log('still mention txt delivery (manual check):', leftovers.slice(0, 20));
else console.log('no leftover txt-delivery phrasing detected.');
