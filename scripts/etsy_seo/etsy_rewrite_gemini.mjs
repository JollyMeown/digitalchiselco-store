// Finish the proposals the Anthropic run could not (credit balance ran out)
// using the Gemini key BRS already uses successfully. Same prompt, same
// validation, same output file, so etsy_apply.mjs sees no difference.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const S = fileURLToPath(new URL('.', import.meta.url)).replace(/[\/]$/, '');
const cfg = JSON.parse(fs.readFileSync('D:/000 BUNDLE RELIEF STUDIO/_config/config.json', 'utf8'));
const KEY = cfg.gemini_api_key;
const MODEL = cfg.gemini_text_model || 'gemini-3-flash-preview';
const weak = JSON.parse(fs.readFileSync(`${S}/etsy_weak_full.json`, 'utf8')).filter((w) => !w.error);
const seed = JSON.parse(fs.readFileSync(`${S}/weak_seed.json`, 'utf8'));
const W = JSON.parse(fs.readFileSync(`${S}/etsy_weak.json`, 'utf8'));
const winnerTags = [...new Set(W.winSample.flatMap((l) => l.tags.map((t) => t.toLowerCase())))].slice(0, 80);
const OUT = `${S}/etsy_proposals.json`;
const done = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const doneIds = new Set(done.map((d) => d.listing_id));

const SYSTEM = `You write Etsy listing titles and tags for DigitalChiselCo, a shop selling digital STL relief files (bas-relief 3D models) that buyers download and carve on CNC routers, engrave with lasers, or 3D print. You are optimising listings that get almost no views.

Rules (hard):
- TITLE: max 140 characters. Lead with the SUBJECT in the clearest buyer phrase in the first 40 characters (what the carving depicts), then "3D Relief STL" or "Bas-Relief STL", then 1-2 useful modifiers (room/use/style), then "CNC Router" and either "Laser" or "3D Print" where natural. Natural readable English, Title Case, separators " | " allowed (max 3 segments). No emoji, no ALL CAPS words, no "free", no brand name.
- TAGS: exactly 13, each 2-20 characters, lowercase, multi-word long-tail phrases a BUYER would type. At least 9 must name the subject/theme/room/occasion (e.g. "trout stl file", "hunting lodge decor", "bald eagle carving", "nursery wall art"). At most 4 tooling tags (e.g. "cnc router file", "3d relief stl", "laser engraving file", "wood carving stl"). No duplicates, no hashtags, no tag that is just a single generic word like "stl".
- Keep the listing's actual subject; never invent details not in the source. Mirror the vocabulary of the WINNING TAGS list where it fits the subject.

Output ONLY a JSON array, one object per input listing, in the same order: [{"listing_id":123,"new_title":"...","tags":["...",...13]}]`;

const clean = (s) => String(s || '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');

async function gemini(batch) {
  const user = `WINNING TAGS: ${winnerTags.join(', ')}\n\nLISTINGS:\n` + batch.map((w) => {
    const sd = seed[w.listing_id];
    return `---\nlisting_id: ${w.listing_id}\ncurrent_title: ${clean(w.title)}\ncurrent_tags: ${w.tags.map(clean).join(', ')}\ndescription_excerpt: ${clean(w.description).replace(/\s+/g, ' ').slice(0, 500)}\n${sd?.kw?.length ? 'website_keywords: ' + sd.kw.slice(0, 12).map(clean).join(', ') + '\n' : ''}`;
  }).join('\n');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8000 } }),
      });
      const j = await r.json();
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').replace(/```(?:json)?/g, '').trim();
      const start = text.indexOf('[');
      if (start >= 0) { try { return JSON.parse(text.slice(start, text.lastIndexOf(']') + 1)); } catch (e) { console.error('json error', e.message.slice(0, 60)); } }
      console.error('retry', attempt, (j.error?.message || text.slice(-120)).slice(0, 160));
    } catch (e) { console.error('network retry', attempt, e.message.slice(0, 80)); }
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  return [];
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
function validate(p, src) {
  const title = String(p.new_title || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const seen = new Set();
  const tags = (p.tags || []).map((t) => String(t).toLowerCase().replace(/[^a-z0-9 &'-]/g, '').replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 2 && t.length <= 20 && !seen.has(t) && seen.add(t));
  for (const t of src.tags.map((x) => x.toLowerCase())) { if (tags.length >= 13) break; if (t.length <= 20 && !seen.has(t)) { tags.push(t); seen.add(t); } }
  return { listing_id: src.listing_id, old_title: src.title, old_tags: src.tags, new_title: title, tags: tags.slice(0, 13), views: src.views, favorers: src.favorers, sales: src.sales, ok: title.length >= 30 && !EMOJI.test(title) && tags.length === 13, engine: 'gemini' };
}

const todo = weak.filter((w) => !doneIds.has(w.listing_id));
console.log('model', MODEL, '| to generate:', todo.length);
for (let i = 0; i < todo.length; i += 5) {
  const batch = todo.slice(i, i + 5);
  const out = await gemini(batch);
  for (const src of batch) { const p = out.find((o) => String(o.listing_id) === String(src.listing_id)); if (!p) { console.error('missing', src.listing_id); continue; } done.push(validate(p, src)); }
  fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
}
console.log('total proposals:', done.length, '| valid:', done.filter((d) => d.ok).length);
