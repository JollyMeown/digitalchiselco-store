// Three title problems found by the 2026-09-15 audit, fixed in one pass:
//   - 38 active products have no seo_title at all (Google shows the raw title)
//   - 35 products share 15 identical seo_titles (Tree of Life x4, Bighorn x3 ...)
//   - any seo_title past 70 characters (cut off in results). The audit's "230
//     too long" turned out to be raw product titles, which only feed the H1;
//     every live seo_title was already within the limit, so this rule found 0.
//
// Every new title is derived from the product's own title, never invented:
// the subject phrase before the first " | ", then the format word the buyer
// searches for, then the brand. Duplicates get the distinguishing detail from
// the product's own second segment. Old values are written to a backup file
// first, so this is reversible.
//
//   node scripts/seo_titles_fix.mjs           # dry run: show every change
//   node scripts/seo_titles_fix.mjs --apply
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');
const BRAND = ' | DigitalChiselCo';
const MAX = 70;

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('products').select('id, slug, title, seo_title, is_bundle').eq('active', true).order('slug').range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...data); if (data.length < 1000) break;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[“”"]/g, '').trim();
const segs = (t) => clean(t).split('|').map((x) => x.trim()).filter(Boolean);
// never end a cut title on a dangling word ("... STL file for | DigitalChiselCo")
const STOP = /\s+(for|and|with|of|the|in|on|a|an|to|or|by|from|at)$/i;
const cut = (s, n) => { let t = s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, ''); t = t.replace(/[\s,;:-]+$/, ''); while (STOP.test(t)) t = t.replace(STOP, ''); return t; };

// subject-first, format word, brand, inside the limit
function build(p, extra = '') {
  const [subject = '', second = ''] = segs(p.title);
  let core = subject;
  // make sure the searched-for format word is present once
  if (!/\bSTL\b/i.test(core)) core += p.is_bundle ? ' STL Bundle' : ' STL';
  if (extra) core += ' ' + extra;
  const room = MAX - BRAND.length;
  return cut(core, room) + BRAND;
}

const changes = [];
// 1) missing or too long
for (const p of rows) {
  const cur = clean(p.seo_title);
  if (!cur || cur.length > MAX) changes.push({ p, from: cur, to: build(p), why: !cur ? 'missing' : `too long (${cur.length})` });
}
// 2) duplicates, after the above so we dedupe the titles that will actually be live
const live = new Map();
for (const p of rows) {
  const t = (changes.find((c) => c.p.id === p.id)?.to || clean(p.seo_title)).toLowerCase();
  if (!live.has(t)) live.set(t, []); live.get(t).push(p);
}
for (const [, group] of live) {
  if (group.length < 2) continue;
  group.sort((a, b) => a.slug.localeCompare(b.slug));
  group.slice(1).forEach((p, i) => {
    // the product's own second segment is the distinguishing detail
    const detail = (segs(p.title)[1] || '').replace(/\b(cnc|router|file|files|digital|download|stl|3d|relief|bas-relief|for)\b/gi, '').replace(/\s+/g, ' ').trim();
    const to = build(p, detail ? `- ${cut(detail, 28)}` : `#${i + 2}`);
    const ex = changes.find((c) => c.p.id === p.id);
    if (ex) { ex.to = to; ex.why += ' + duplicate'; } else changes.push({ p, from: clean(p.seo_title), to, why: 'duplicate' });
  });
}

console.log(`${changes.length} titles to change (of ${rows.length} active)`);
const byWhy = {}; for (const c of changes) byWhy[c.why.split(' +')[0]] = (byWhy[c.why.split(' +')[0]] || 0) + 1; console.log(byWhy);
for (const c of changes.slice(0, 14)) console.log(`\n[${c.why}]\n  was: ${c.from || '(none)'}\n  now: ${c.to}  (${c.to.length})`);
const over = changes.filter((c) => c.to.length > MAX); if (over.length) console.log('\nSTILL OVER 70:', over.length);
const dupNow = new Set(); let dups = 0; for (const c of changes) { const k = c.to.toLowerCase(); if (dupNow.has(k)) dups++; dupNow.add(k); } console.log('duplicates among new titles:', dups);

if (!APPLY) { console.log('\ndry run. re-run with --apply'); process.exit(0); }
fs.mkdirSync('.backups', { recursive: true });
fs.writeFileSync(`.backups/seo_titles_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(changes.map((c) => ({ id: c.p.id, slug: c.p.slug, from: c.from, to: c.to })), null, 1));
let ok = 0;
for (const c of changes) {
  const { error } = await db.from('products').update({ seo_title: c.to }).eq('id', c.p.id);
  if (error) console.log('  ✗', c.p.slug, error.message); else ok++;
}
console.log(`\napplied ${ok}/${changes.length}. backup in .backups/`);
