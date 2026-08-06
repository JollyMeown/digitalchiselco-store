// Resolves the flagged link-review items. For each flagged product it decides:
//   CLEAR  - current link is correct (shares the product's distinctive keyword,
//            or matches the Etsy title well enough) — just SEO-renamed on site.
//   FIX    - current file shares NONE of the title's distinctive keywords but a
//            specific Drive file DOES — repoint to that file.
//   MANUAL - genuinely ambiguous (no distinctive keyword, or several candidates,
//            or a multi-file bundle) — needs human eyes.
//
// "Distinctive" = a title token that appears in <=12 product titles (rare enough
// to identify the product; excludes boilerplate like tray/relief/jesus/eagle).
//
// Usage: node scripts/etsy_link_review.mjs [--apply]
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NOISE = new Set(['stl','file','files','cnc','router','3d','digital','download','model','design','final','wall','decor','art','and','the','for','with','of','a','an','in','on','to','or','by','relief','wood','wooden','carving','scene','panel','home','gift','instant','commercial','use','included','bas','round','woodworking','pattern','vcarve','aspire','artcam','carveco','usa','cut','ready','print']);
const tok = (s)=>[...new Set((s||'').toLowerCase().replace(/\.stl$/i,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter((w)=>w.length>=3 && !NOISE.has(w)))];
const idOf = (u)=>(u?(u.match(/[?&]id=([A-Za-z0-9_-]{20,})/)||u.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/)||[])[1]||null:null);
const biScore = (aT,bSet)=>{ if(!aT.length||!bSet.size) return 0; const h=aT.filter((t)=>bSet.has(t)).length; return Math.min(h/aT.length, h/bSet.size); };

const drive = JSON.parse(readFileSync('drive_all_files.json','utf8')).filter((f)=>f.name.toLowerCase().endsWith('.stl'));
const driveTok = drive.map((d)=>({ id:d.id, name:d.name, toks:tok(d.name), lc:d.name.toLowerCase() }));

// products + current link
const products=[];
for(let from=0;;from+=1000){ const {data}=await db.from('products').select('id, slug, title, original_title, image_url, is_bundle, active').range(from,from+999); if(!data?.length)break; products.push(...data); if(data.length<1000)break; }
const pIds=products.map((p)=>p.id);
const dlByP=new Map();
for(let i=0;i<pIds.length;i+=300){ const {data}=await db.from('product_downloads').select('id, product_id, download_link, sort_order').in('product_id',pIds.slice(i,i+300)); for(const d of (data||[])){ const a=dlByP.get(d.product_id)||[]; a.push(d); dlByP.set(d.product_id,a);} }

// document frequency for distinctiveness
const df=new Map();
for(const p of products){ for(const t of tok(p.original_title||p.title)) df.set(t,(df.get(t)||0)+1); }
const distinctiveOf=(toks)=>toks.filter((t)=>(df.get(t)||0)<=12);

// which drive ids are shared by multiple products
const idUsers=new Map();
for(const p of products){ for(const d of (dlByP.get(p.id)||[])){ const id=idOf(d.download_link); if(id){ const a=idUsers.get(id)||[]; a.push(p.id); idUsers.set(id,a);} } }

// find the drive file that best fits a title's distinctive keywords
function findByDistinctive(distinct, titleToks){
  if(!distinct.length) return null;
  const cands=driveTok.map((f)=>{
    const dHits=distinct.filter((t)=>f.toks.includes(t)).length;
    return { f, dHits, ov: biScore(f.toks, new Set(titleToks)) };
  }).filter((c)=>c.dHits>=1).sort((a,b)=> b.dHits-a.dHits || b.ov-a.ov);
  if(!cands.length) return null;
  const top=cands[0];
  // must cover ALL distinctive tokens and clearly beat runner-up on distinctive hits
  const decisive = top.dHits===distinct.length && (cands.length<2 || cands[1].dHits<top.dHits || (top.ov-cands[1].ov)>=0.15);
  return { id:top.f.id, name:top.f.name, dHits:top.dHits, ov:+top.ov.toFixed(2), decisive, nCand:cands.length };
}

const FLAG = new Set(['LOW_MATCH_REVIEW','DUPLICATE_REVIEW','FILE_MISSING_REVIEW','MISSING_LINK_REVIEW','MALFORMED_LINK']);
const report = JSON.parse(readFileSync('link-mismatch-report.json','utf8'));
const flaggedIds = new Set(report.filter((r)=>FLAG.has(r.verdict)).map((r)=>r.product_id));
// also include bundles for listing (but never auto-fix)
const bundleIds = new Set(report.filter((r)=>r.verdict==='BUNDLE_SKIP').map((r)=>r.product_id));

const out={ clear:[], fix:[], manual:[], bundle:[] };
for(const p of products){
  if(!flaggedIds.has(p.id) && !bundleIds.has(p.id)) continue;
  const title=p.original_title||p.title;
  const tToks=tok(title);
  const tSet=new Set(tToks);
  const distinct=distinctiveOf(tToks);
  const dls=(dlByP.get(p.id)||[]).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const curId=dls.length?idOf(dls[0].download_link):null;
  const curFile=curId?driveTok.find((f)=>f.id===curId):null;
  const curShares=curFile?distinct.some((t)=>curFile.toks.includes(t)):false;
  const curOv=curFile?biScore(curFile.toks,tSet):0;
  const dup=curId?(idUsers.get(curId)?.length||0):0;
  const rowBase={ slug:p.slug, product_id:p.id, active:p.active, title, cur_id:curId, cur_name:curFile?.name||null, cur_ov:+curOv.toFixed(2), dup, download_id:dls[0]?.id||null, image:p.image_url };

  if(bundleIds.has(p.id)){ out.bundle.push({...rowBase, note:'multi-file bundle'}); continue; }

  const sharedCount = curFile ? curFile.toks.filter((t)=>tSet.has(t)).length : 0;
  const match = findByDistinctive(distinct, tToks);
  const strongAlt = match && match.decisive && match.ov>=0.55 && match.id!==curId;

  // FIX: a strong alternative exists (near-exact title match, covers all identity
  // keywords) that clearly beats the current file. Also covers missing links.
  if(strongAlt && (!curFile || (match.ov - curOv) >= 0.25)){
    out.fix.push({...rowBase, verdict: !curFile?'ADD':'REPOINT', new_id:match.id, new_name:match.name, new_ov:match.ov });
  }
  // CLEAR: current file plainly belongs to this product — shares a rare keyword,
  // OR >=2 meaningful tokens, OR a decent overall match — and no strong alt beats it.
  else if(curFile && (curShares || sharedCount>=2 || curOv>=0.3)){
    out.clear.push({...rowBase, reason: curShares?'distinctive keyword':(sharedCount>=2?`${sharedCount} shared tokens`:'good match') });
  }
  // Otherwise a human decides.
  else {
    out.manual.push({...rowBase, best_guess: match?`${match.name} (dHits ${match.dHits}/${distinct.length||'?'}, ov ${match.ov}${match.decisive&&match.ov>=0.55?'':' — weak/ambiguous'})`:'(no keyword candidate)', distinct:distinct.join(',')||'(none)' });
  }
}

console.log(`Flagged reviewed: ${out.clear.length+out.fix.length+out.manual.length+out.bundle.length}`);
console.log(`  CLEAR (correct, no action): ${out.clear.length}`);
console.log(`  FIX (repoint/add to correct file): ${out.fix.length}`);
console.log(`  MANUAL (needs your eyes): ${out.manual.length}`);
console.log(`  BUNDLE (multi-file, listed): ${out.bundle.length}`);
console.log('\n--- FIX ---');
out.fix.forEach((r)=>console.log(`  ${r.verdict} ${r.slug.slice(0,40)}\n     title: ${r.title.slice(0,60)}\n     cur:   ${(r.cur_name||'(none)').slice(0,60)}\n     new:   ${r.new_name.slice(0,60)} [${r.new_ov}]`));
console.log('\n--- MANUAL ---');
out.manual.forEach((r)=>console.log(`  ${r.slug.slice(0,42)} | dup${r.dup} | keys:[${r.distinct}]\n     title: ${r.title.slice(0,58)}\n     cur:   ${(r.cur_name||'(none)').slice(0,58)}\n     guess: ${r.best_guess.slice(0,64)}`));

writeFileSync('link-review-resolved.json', JSON.stringify(out,null,2));

if(APPLY){
  let fixed=0,added=0;
  for(const r of out.fix){
    const link=`https://drive.google.com/uc?export=download&id=${r.new_id}`;
    if(r.download_id){ const {error}=await db.from('product_downloads').update({download_link:link,drive_file_id:r.new_id,audit_status:'etsy_relinked'}).eq('id',r.download_id); if(!error)fixed++; }
    else { const {error}=await db.from('product_downloads').insert({product_id:r.product_id,download_link:link,drive_file_id:r.new_id,sort_order:0,audit_status:'etsy_relinked'}); if(!error)added++; }
  }
  // CLEAR items: stamp as verified so they drop out of future flags
  const clearIds=out.clear.map((r)=>r.download_id).filter(Boolean);
  for(let i=0;i<clearIds.length;i+=200){ await db.from('product_downloads').update({audit_status:'etsy_verified'}).in('id',clearIds.slice(i,i+200)); }
  console.log(`\nAPPLIED: ${fixed} repointed, ${added} added, ${clearIds.length} cleared-as-verified.`);
} else {
  console.log(`\n(dry run) would: repoint/add ${out.fix.length}, mark ${out.clear.length} verified. Rerun with --apply.`);
}
