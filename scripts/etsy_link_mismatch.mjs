// Detects products whose download link points to the WRONG Google Drive STL,
// using ETSY as the reference: every Drive STL is named after its product, and
// products.original_title holds the authoritative Etsy title. For each product
// we (a) score its CURRENT linked file's name against the Etsy title, and
// (b) find the best-matching Drive file for that title. A link is "wrong" when
// its current file barely matches the title but a clearly better file exists.
//
// Also recovers links for products that have none (newly imported).
//
// Output: link-mismatch-report.json + console summary.
// Writes fixes only with --apply (high-confidence only; bundles never auto-fixed).
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NOISE = new Set(['stl','file','files','cnc','router','3d','digital','download','model','design','final','wall','decor','art','and','the','for','with','of','a','an','in','on','to','or','by','relief','wood','wooden','carving','scene','panel','wallart','home','gift','instant','commercial','use','included','bas','round','3dmodel','woodworking','pattern','vcarve','aspire','artcam','carveco']);
const tok = (s) => [...new Set((s||'').toLowerCase().replace(/\.stl$/i,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter((w)=>w.length>=3 && !NOISE.has(w)))];
const idOf = (u) => (u ? (u.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || u.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] || null : null);
// BIDIRECTIONAL score: a file only "matches" a title when the file's tokens are
// covered by the title AND the title's tokens are covered by the file. This
// kills spurious matches from short generic filenames (Family.stl, Wooden Tray.stl):
// they cover almost none of a real title, so score stays low. Returns 0..1.
const scoreMatch = (fileTokens, titleTokens) => {
  if (fileTokens.length < 3 || !titleTokens.length) return 0;   // ignore too-generic files
  const tset = new Set(titleTokens);
  const hits = fileTokens.filter((t) => tset.has(t)).length;
  const fileCov = hits / fileTokens.length;
  const titleCov = hits / titleTokens.length;
  return Math.min(fileCov, titleCov);                            // both must be high
};
// legacy one-way coverage used to judge whether the CURRENT link is acceptable
const overlap = (fileTokens, titleSet) => {
  if (!fileTokens.length) return 0;
  return fileTokens.filter((t) => titleSet.has(t)).length / fileTokens.length;
};

// --- Drive index ------------------------------------------------------------
const drive = JSON.parse(readFileSync('drive_stls.json','utf8'));
const driveById = new Map(drive.map((d)=>[d.id,d.name]));
const driveTok = drive.map((d)=>({ id:d.id, name:d.name, toks:tok(d.name) }));
console.log(`Drive STL index: ${driveById.size} files`);

// --- products + their single download link ----------------------------------
const products = [];
for (let from=0;;from+=1000){
  const { data } = await db.from('products').select('id, slug, title, original_title, image_url, is_bundle, is_subscription, active, link_status').range(from, from+999);
  if (!data?.length) break; products.push(...data);
  if (data.length<1000) break;
}
// distinctive tokens: those appearing in few product titles carry identity
// (e.g. "lobster","tortoise") vs boilerplate ("tray","router"). A suggested file
// must contain at least one of the product's distinctive tokens.
const df = new Map();
for (const p of products){ for (const t of new Set(tok(p.original_title||p.title))) df.set(t,(df.get(t)||0)+1); }
const distinctiveOf = (toks) => toks.filter((t)=>(df.get(t)||0) <= 8);   // truly rare identity tokens only
const pIds = products.map((p)=>p.id);
const dlByProduct = new Map();
for (let i=0;i<pIds.length;i+=300){
  const { data } = await db.from('product_downloads').select('id, product_id, download_link, sort_order').in('product_id', pIds.slice(i,i+300));
  for (const d of (data||[])){
    const arr = dlByProduct.get(d.product_id) || []; arr.push(d); dlByProduct.set(d.product_id, arr);
  }
}
console.log(`Products: ${products.length}`);

// count how many products share each drive id (duplicate detection)
const idUsers = new Map();
for (const p of products){
  const dls = dlByProduct.get(p.id) || [];
  for (const d of dls){ const id=idOf(d.download_link); if(id){ const a=idUsers.get(id)||[]; a.push(p.id); idUsers.set(id,a);} }
}

// --- evaluate ----------------------------------------------------------------
const OK_TH = 0.45, LOW_TH = 0.30, BEST_TH = 0.60;
const rows = [];
for (const p of products){
  if (p.is_subscription) continue;
  const etsyTitle = p.original_title || p.title;
  const titleToks = tok(etsyTitle);
  const titleSet = new Set(titleToks);
  const dls = (dlByProduct.get(p.id) || []).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const isBundle = p.is_bundle || dls.length > 1;

  // best matching drive file for this title (bidirectional score) + runner-up,
  // so we can require the winner to be DECISIVE (clearly beats 2nd place).
  let best = { ov:0, id:null, name:null }, second = 0;
  if (titleSet.size){
    for (const f of driveTok){
      const ov = scoreMatch(f.toks, titleToks);
      if (ov > best.ov){ second = best.ov; best = { ov, id:f.id, name:f.name }; }
      else if (ov > second){ second = ov; }
    }
  }
  // decisive = strong, unambiguous, AND the file shares a distinctive (non-
  // boilerplate) token with the title — this rejects the serving-tray trap where
  // shared "wooden tray cnc router" boilerplate makes an unrelated file look great.
  const distinct = distinctiveOf(titleToks);
  const bestToks = best.id ? new Set((driveTok.find((f)=>f.id===best.id)||{toks:[]}).toks) : new Set();
  const sharesDistinct = distinct.some((t)=>bestToks.has(t));
  const decisive = best.ov >= BEST_TH && (best.ov - second) >= 0.15 && sharesDistinct;

  const curId = dls.length ? idOf(dls[0].download_link) : null;
  const curName = curId ? (driveById.get(curId) || null) : null;
  const curOv = curName ? overlap(tok(curName), titleSet) : 0;
  const dupCount = curId ? (idUsers.get(curId)?.length || 0) : 0;

  // AUTO-FIX only the SAFE cases: a product with NO usable file today (missing
  // link, or link points to a file that's gone) AND a decisive title match.
  // Products that merely have a low-overlap-but-present file are REVIEW only —
  // never silently repointed (their current file is usually correct, just named
  // differently from the SEO title).
  // Auto-fix requires a DECISIVE match (strong, unambiguous, shares a distinctive
  // non-boilerplate keyword with the title). Safe cases only:
  //   - product has NO link today (nothing to break), or
  //   - present link's file is gone from Drive, or
  //   - present link clearly points to a DIFFERENT product (very low current match)
  let verdict, action=null;
  const cleanWrong = curName && curOv < 0.25 && decisive && best.ov >= 0.70 && best.id !== curId;
  if (isBundle){
    verdict = 'BUNDLE_SKIP';
  } else if (!dls.length){
    verdict = decisive ? 'MISSING_LINK_AUTOFIX' : 'MISSING_LINK_REVIEW';
    if (decisive) action={ set:best.id };
  } else if (!curId){
    verdict = 'MALFORMED_LINK';
  } else if (!curName){                            // link points to a file not in Drive
    verdict = decisive ? 'FILE_MISSING_AUTOFIX' : 'FILE_MISSING_REVIEW';
    if (decisive) action={ set:best.id };
  } else if (curOv>=OK_TH){
    verdict = 'OK';
  } else if (cleanWrong){
    verdict = 'WRONG_LINK_AUTOFIX';                // present file belongs to another product
    action={ set:best.id };
  } else if (dupCount>1){
    verdict = 'DUPLICATE_REVIEW';                  // shared file — ambiguous, human decides
  } else {
    verdict = 'LOW_MATCH_REVIEW';                  // present file, weak title match — verify
  }

  if (verdict!=='OK') rows.push({
    slug:p.slug, product_id:p.id, active:p.active, verdict,
    etsy_title:etsyTitle, cur_id:curId, cur_name:curName, cur_overlap:+curOv.toFixed(2),
    dup_count:dupCount, best_id:best.id, best_name:best.name, best_overlap:+best.ov.toFixed(2),
    best_decisive:decisive, proposed_set: action?.set || null, download_id: dls[0]?.id || null,
  });
}

// --- summary -----------------------------------------------------------------
const by = {};
for (const r of rows) by[r.verdict]=(by[r.verdict]||0)+1;
console.log('\n================ LINK MISMATCH ================');
console.log(`OK (not listed): ${products.length - rows.length}`);
for (const [k,v] of Object.entries(by).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(24)} ${v}`);

const show = (v,n=12)=>{ const r=rows.filter(x=>x.verdict===v); r.slice(0,n).forEach(x=>console.log(`  [cur ${x.cur_overlap} -> best ${x.best_overlap}${x.best_decisive?' *decisive*':''}] ${x.slug.slice(0,42)}\n        title: ${x.etsy_title.slice(0,62)}\n        cur:   ${(x.cur_name||'(none)').slice(0,62)}\n        best:  ${(x.best_name||'(none)').slice(0,62)}`)); if(r.length>n)console.log(`  ...+${r.length-n} more`); };
console.log('\n--- MISSING_LINK_AUTOFIX (new products, decisive match) ---'); show('MISSING_LINK_AUTOFIX',10);
console.log('\n--- FILE_MISSING_AUTOFIX (linked file gone, decisive replacement) ---'); show('FILE_MISSING_AUTOFIX',10);
console.log('\n--- DUPLICATE_REVIEW (file shared by several products) ---'); show('DUPLICATE_REVIEW',8);
console.log('\n--- LOW_MATCH_REVIEW (present file, weak title match — verify) ---'); show('LOW_MATCH_REVIEW',8);

writeFileSync('link-mismatch-report.json', JSON.stringify(rows,null,2));
console.log('\nReport: link-mismatch-report.json');

// --- visual HTML review report ----------------------------------------------
const esc = (s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const imgByProduct = new Map(products.map((p)=>[p.id, p.image_url]));
const order = ['LOW_MATCH_REVIEW','DUPLICATE_REVIEW','FILE_MISSING_REVIEW','FILE_MISSING_AUTOFIX','MISSING_LINK_REVIEW','MISSING_LINK_AUTOFIX','MALFORMED_LINK','BUNDLE_SKIP'];
const sorted = [...rows].sort((a,b)=>(order.indexOf(a.verdict)-order.indexOf(b.verdict)) || (a.cur_overlap-b.cur_overlap));
const card = (r)=>`<tr>
  <td><img src="${esc(imgByProduct.get(r.product_id)||'')}" style="width:120px;height:120px;object-fit:cover;border-radius:8px" loading="lazy" referrerpolicy="no-referrer"></td>
  <td>
    <span style="background:#eee;border-radius:10px;padding:2px 8px;font-size:11px">${r.verdict}</span>
    ${r.active?'':'<span style="background:#fde68a;border-radius:10px;padding:2px 8px;font-size:11px;margin-left:4px">inactive</span>'}
    <div style="font-weight:600;margin:6px 0">${esc(r.etsy_title)}</div>
    <div style="font-size:12px;color:#555"><a href="https://digitalchiselco.com/product/${esc(r.slug)}" target="_blank">${esc(r.slug)}</a></div>
    <div style="margin-top:8px;font-size:13px">
      <div><b>Currently linked file:</b> <code>${esc(r.cur_name||'(none / not in Drive index)')}</code> &middot; match ${r.cur_overlap}${r.dup_count>1?` &middot; <span style="color:#b45309">shared by ${r.dup_count} products</span>`:''}</div>
      <div style="margin-top:4px"><b>Best title match in Drive:</b> <code>${esc(r.best_name||'(none)')}</code> &middot; ${r.best_overlap}${r.best_decisive?' <b style="color:#15803d">✓ decisive</b>':' <span style="color:#999">(not decisive — verify)</span>'}</div>
      ${r.cur_id?`<div style="margin-top:4px"><a href="https://drive.google.com/uc?export=download&id=${esc(r.cur_id)}" target="_blank">open current file</a>${r.best_id&&r.best_id!==r.cur_id?` &nbsp;|&nbsp; <a href="https://drive.google.com/uc?export=download&id=${esc(r.best_id)}" target="_blank">open suggested file</a>`:''}</div>`:(r.best_id?`<div style="margin-top:4px"><a href="https://drive.google.com/uc?export=download&id=${esc(r.best_id)}" target="_blank">open suggested file</a></div>`:'')}
    </div>
  </td></tr>`;
const html = `<!doctype html><meta charset=utf-8><title>Link mismatch review</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;max-width:1000px;margin:20px auto;padding:0 16px;color:#222}td{border-top:1px solid #eee;padding:12px 8px;vertical-align:top}code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12px}h1{font-size:20px}</style>
<h1>Download-link review — ${sorted.length} products need eyes</h1>
<p style="color:#555">Etsy title is the reference. "Decisive" suggestions matched a Drive file strongly, unambiguously, and on a distinctive keyword. Open both files to compare before fixing. Green ✓ = safe to auto-apply.</p>
<table>${sorted.map(card).join('')}</table>`;
writeFileSync('link-mismatch-review.html', html);
console.log('Visual review: link-mismatch-review.html');

// --- apply high-confidence fixes --------------------------------------------
// Only rows with `proposed_set` (DECISIVE + distinctive keyword) are applied.
// Everything else stays in the review report.
const auto = rows.filter((r)=>r.proposed_set);
if (APPLY){
  let fixed=0, added=0, err=0;
  for (const r of auto){
    const link = `https://drive.google.com/uc?export=download&id=${r.proposed_set}`;
    if (r.download_id){
      const { error } = await db.from('product_downloads').update({ download_link: link, drive_file_id: r.proposed_set, audit_status:'etsy_relinked' }).eq('id', r.download_id);
      error ? err++ : fixed++;
    } else {
      const { error } = await db.from('product_downloads').insert({ product_id:r.product_id, download_link: link, drive_file_id:r.proposed_set, sort_order:0, audit_status:'etsy_relinked' });
      error ? err++ : added++;
    }
  }
  console.log(`\nAPPLIED: ${fixed} links corrected, ${added} links added${err?`, ${err} errors`:''}.`);
} else {
  console.log(`\n(dry run) ${auto.length} decisive fixes ready (${auto.filter(r=>!r.download_id).length} new links, ${auto.filter(r=>r.download_id).length} corrections) — rerun with --apply`);
}
