// Generate a new title + 13 tags for every WEAK Etsy listing (views<20, 0 sales).
//
// What the data said (winners vs weak, 1,474 listings, 3,727 receipts/365d):
//   - Both groups use all 13 tags, so tag COUNT is not the difference.
//   - Winners' tags name the SUBJECT a buyer types ("trout stl", "bald eagle
//     stl", "hunting lodge decor", "father day stl"). Weak listings' tags name
//     the TOOLING ("vcarve pro model", "aspire 3d model", "carveco relief").
//   - Winning titles lead with the subject ("Whitetail Buck Forest Scene 3D
//     Relief STL"); weak ones bury it behind gift/generic words.
// Etsy 2026 guidance: first ~40 chars carry the clearest phrase, natural
// language over keyword stuffing, all 13 tags, multi-word long-tail tags.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const S = fileURLToPath(new URL('.', import.meta.url)).replace(/[\/]$/, '');
const env = fs.readFileSync('D:/000 DIGITAL CHISEL WEBSITE/.env', 'utf8');
const KEY = (env.match(/^ANTHROPIC_API_KEY=(.*)$/m) || [])[1]?.trim();
const weak = JSON.parse(fs.readFileSync(`${S}/etsy_weak_full.json`, 'utf8')).filter((w) => !w.error);
const seed = JSON.parse(fs.readFileSync(`${S}/weak_seed.json`, 'utf8'));
const W = JSON.parse(fs.readFileSync(`${S}/etsy_weak.json`, 'utf8'));
const winnerTags = [...new Set(W.winSample.flatMap((l) => l.tags.map((t) => t.toLowerCase())))].slice(0, 80);
const OUT = `${S}/etsy_proposals.json`;
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const doneIds = new Set(done.map((d) => d.listing_id));

const SYSTEM = `You write Etsy listing titles and tags for DigitalChiselCo, a shop selling digital STL relief files (bas-relief 3D models) that buyers download and carve on CNC routers, engrave with lasers, or 3D print. You are optimising listings that get almost no views.

Rules (hard):
- TITLE: max 140 characters. Lead with the SUBJECT in the clearest buyer phrase in the first 40 characters (what the carving depicts), then "3D Relief STL" or "Bas-Relief STL", then 1-2 useful modifiers (room/use/style), then "CNC Router" and either "Laser" or "3D Print" where natural. Natural readable English, Title Case, separators " | " allowed (max 3 segments). No emoji, no ALL CAPS words, no "free", no brand name.
- TAGS: exactly 13, each 2-20 characters, lowercase, multi-word long-tail phrases a BUYER would type. At least 9 must name the subject/theme/room/occasion (e.g. "trout stl file", "hunting lodge decor", "bald eagle carving", "nursery wall art"). At most 4 tooling tags (e.g. "cnc router file", "3d relief stl", "laser engraving file", "wood carving stl"). No duplicates, no hashtags, no tag that is just a single generic word like "stl".
- Keep the listing's actual subject; never invent details not in the source. Mirror the vocabulary of the WINNING TAGS list where it fits the subject.

Output ONLY a JSON array, one object per input listing, in the same order: [{"listing_id":123,"new_title":"...","tags":["...",...13]}]`;

// Some Etsy descriptions contain half an emoji (a lone UTF-16 surrogate).
// JSON.stringify then emits invalid JSON and the API rejects the whole batch
// ("no low surrogate in string"), so scrub those before building the prompt.
const clean = (s) => String(s || '')
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');

async function claude(batch) {
  const user = `WINNING TAGS (from the shop's best sellers, for vocabulary): ${winnerTags.join(', ')}\n\nLISTINGS:\n` + batch.map((w) => {
    const sd = seed[w.listing_id];
    return `---\nlisting_id: ${w.listing_id}\ncurrent_title: ${clean(w.title)}\ncurrent_tags: ${w.tags.map(clean).join(', ')}\ndescription_excerpt: ${clean(w.description).replace(/\s+/g, ' ').slice(0, 500)}\n${sd?.kw?.length ? 'website_keywords: ' + sd.kw.slice(0, 12).map(clean).join(', ') + '\n' : ''}${sd?.cat?.length ? 'category: ' + sd.cat.join(' / ') + '\n' : ''}`;
  }).join('\n');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 16000, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
      });
      const j = await r.json();
      // responses can lead with a "thinking" block; take the text block, not [0]
      const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        .replace(/```(?:json)?/g, '').trim();
      // balanced scan from the first '[' so trailing prose or a stray bracket
      // cannot poison the greedy match
      const start = text.indexOf('[');
      if (start >= 0) {
        let depth = 0, inStr = false, esc = false;
        for (let k = start; k < text.length; k++) {
          const ch = text[k];
          if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
          if (ch === '"') inStr = true;
          else if (ch === '[' || ch === '{') depth++;
          else if (ch === ']' || ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, k + 1)); } catch (e) { console.error('json error:', e.message.slice(0, 80), '| tail:', text.slice(Math.max(0, k - 100), k + 1)); } break; } }
        }
      }
      console.error('parse retry', attempt, 'stop_reason=' + j.stop_reason, (j.error?.message || text.slice(-160)));
    } catch (e) {
      // ECONNRESET etc: the network hiccup must not kill a 45-batch run
      console.error('network retry', attempt, e.message.slice(0, 80));
    }
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  return [];
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
function validate(p, src) {
  const title = String(p.new_title || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const seen = new Set();
  const tags = (p.tags || []).map((t) => String(t).toLowerCase().replace(/[^a-z0-9 &'-]/g, '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 2 && t.length <= 20 && !seen.has(t) && seen.add(t));
  // top up from the listing's existing tags if the model came up short
  for (const t of src.tags.map((x) => x.toLowerCase())) { if (tags.length >= 13) break; if (t.length <= 20 && !seen.has(t)) { tags.push(t); seen.add(t); } }
  const ok = title.length >= 30 && !EMOJI.test(title) && tags.length === 13;
  return { listing_id: src.listing_id, old_title: src.title, old_tags: src.tags, new_title: title, tags: tags.slice(0, 13), views: src.views, favorers: src.favorers, sales: src.sales, ok };
}

const todo = weak.filter((w) => !doneIds.has(w.listing_id));
console.log('to generate:', todo.length, '| already:', done.length);
for (let i = 0; i < todo.length; i += 5) {
  const batch = todo.slice(i, i + 5);
  const out = await claude(batch);
  for (const src of batch) {
    const p = out.find((o) => String(o.listing_id) === String(src.listing_id));
    if (!p) { console.error('missing', src.listing_id); continue; }
    done.push(validate(p, src));
  }
  fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
  if ((i / 5) % 5 === 0) console.log(`${Math.min(i + 5, todo.length)}/${todo.length}`);
}
const bad = done.filter((d) => !d.ok);
console.log('\ngenerated:', done.length, '| failed validation:', bad.length);
console.log('\nSAMPLES:');
for (const d of done.slice(0, 8)) {
  console.log(`\n[${d.listing_id}] ${d.views} views`);
  console.log('  OLD:', d.old_title.slice(0, 110));
  console.log('  NEW:', d.new_title);
  console.log('  tags:', d.tags.join(' | '));
}
