// Generate SEO-optimized titles + descriptions for products using Claude Opus
// 4.8 with vision. Reads each product's IMAGE (the source of truth for what's
// depicted) plus its existing title/category/description (for specs + software),
// then writes beautifully crafted, human-sounding copy into the proposed_*
// staging columns. Nothing goes live until approved in the admin SEO Review tab.
//
// Requirements baked in:
//   - V3 combination: vision corrects/enriches the existing text
//   - Human voice, no AI tics, NO em-dashes or en-dashes anywhere
//   - Names the real software (Aspire, VCarve Pro, Carveco, ArtCAM, Fusion 360)
//     and machines (CNC router, laser engraver, 3D printer) when appropriate
//   - Hooks + clear calls to action, written for buyer psychology
//   - Every display title is unique across the catalog
//   - No "Etsy"/marketplace wording, no donation/charity framing (Paddle-safe)
//   - Never invents specs (file size, polygon count, exact dimensions)
//
// Usage:
//   npm run seo:generate -- --limit 5                 # first 5 unprocessed
//   npm run seo:generate -- --category wildlife-wall-art-stl --limit 20
//   npm run seo:generate -- --only-missing --limit 50 # only thin/empty descriptions
//   npm run seo:generate -- --slug howling-wolf-moon-3d-relief-stl-2  # one product
//   npm run seo:generate -- --force --limit 5         # re-generate already-staged
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const MODEL = 'claude-opus-4-8';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('\n✗ ANTHROPIC_API_KEY is not set.');
  console.error('  Add it to your .env (local only — never commit) and re-run.\n');
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey });
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- CLI ----------
const args = process.argv.slice(2);
const arg = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(name);
const LIMIT = Number(arg('--limit', '5'));
const CATEGORY = arg('--category', null);
const SLUG = arg('--slug', null);
const ONLY_MISSING = has('--only-missing');
const FORCE = has('--force');

// ---------- helpers ----------
// Right-size the image so vision tokens stay reasonable and fetch is fast.
function renderUrl(url) {
  if (!url || !url.includes('/storage/v1/object/public/')) return url;
  return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=800&quality=80';
}
function normTitle(t) { return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
// Final safety net: collapse any em/en dash the model slipped in into a comma.
function killDashes(s) { return String(s || '').replace(/\s*[—–]\s*/g, ', ').replace(/, ,/g, ',').replace(/ {2,}/g, ' '); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FORBIDDEN = /\betsy\b|\bmarketplace\b|\bdonat(e|ion)\b|\bcharity\b|\bwelfare\b/i;

const SYSTEM = `You are the single best e-commerce SEO copywriter alive, with deep expertise in buyer psychology, conversion, and lead generation. You write product copy for DigitalChiselCo, a premium store selling downloadable STL files for CNC routers, laser engravers, and 3D printers (bas-relief wood-carving designs).

You will be given ONE product: its image, its current title, its category, and its current description. Study the IMAGE first. It is the source of truth for what the design actually depicts. The current text may be inaccurate or keyword-stuffed. Use the image to get the subject right, and use the existing text only for hard facts (which software it is tested in, what it is used for).

Write copy that ranks on Google AND makes a maker want to buy. Follow every rule:

VOICE
- Sound like a real human craftsperson who knows this trade, not like AI. Vary sentence length and rhythm. No corporate filler, no clichés, no "elevate your space", no "look no further", no "whether you are".
- NEVER use em-dashes (—) or en-dashes (–). Not once. Use commas, periods, or parentheses instead. This is a hard rule.
- Write in confident, warm, plain English.

ACCURACY
- Describe only what is actually in the image. Do not invent file sizes, polygon counts, or exact dimensions.
- Name the real software when it fits, drawn from the source text: Aspire, VCarve Pro, Carveco, ArtCAM, Fusion 360. Name the real machines: CNC router, laser engraver, 3D printer.
- It is true and fine to say: instant digital download, commercial use included, tested/ready for the software above.

FORBIDDEN
- Never write the word "Etsy" or "marketplace" or reference any other shop.
- Never mention donations, charity, welfare, or giving a percentage away.
- Do not mention price.

STRUCTURE OF THE BODY (200 to 300 words, three short paragraphs)
1. A HOOK. Open with one or two vivid sentences about what the piece depicts and the feeling of the finished carve. Make them want it.
2. The substance. What it is (a high-detail bas-relief STL), how it carves (clean toolpaths, depth), which software and machines it is ready for, what they can make with it (wall art, signs, gifts, decor).
3. A close with a clear CALL TO ACTION. Instant download, commercial use included, carve it, sell it, gift it.

TITLES
- display_title: the human, on-page H1. Specific and distinctive (the subject leads). Around 50 to 70 characters. No brand name, no pipes, no em-dash.
- seo_title: the Google meta title. Around 55 to 60 characters, primary keyword first, ending with " | DigitalChiselCo". No em-dash.
- Every display_title must be DISTINCT from every other product. Lead with the specific subject so two similar products never collide.

Return ONLY a JSON object, nothing before or after it, with exactly these keys:
{
  "display_title": string,
  "seo_title": string,
  "seo_description": string,   // 150 to 160 characters, compelling, a soft CTA, no em-dash
  "body": string,              // the 3-paragraph description above, paragraphs separated by \\n\\n
  "alt_text": string,          // under 125 chars, plainly describes the carved image, for Google Image search
  "keywords": string[]         // 8 to 12 long-tail search phrases buyers would type
}`;

function userBlocks(p, imgUrl, retryNote) {
  const cats = (p.product_categories || []).map((pc) => pc.categories?.name).filter(Boolean).join(', ');
  const text = `Current title: ${p.title}
Category: ${cats || '(none)'}
Current description (for facts only, may be inaccurate):
${(p.description || '(none)').slice(0, 1800)}${retryNote ? `\n\nIMPORTANT: ${retryNote}` : ''}`;
  const blocks = [];
  if (imgUrl) blocks.push({ type: 'image', source: { type: 'url', url: imgUrl } });
  blocks.push({ type: 'text', text });
  return blocks;
}

function parseJson(raw) {
  let s = String(raw || '').trim();
  // strip markdown fences if present
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

async function generateOne(p, seen) {
  const imgUrl = renderUrl(p.image_url);
  let retryNote = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{ role: 'user', content: userBlocks(p, imgUrl, retryNote) }],
    });
    const textBlock = res.content.find((b) => b.type === 'text');
    if (!textBlock) { retryNote = 'Return only the JSON object.'; continue; }

    let data;
    try { data = parseJson(textBlock.text); }
    catch { retryNote = 'Your previous reply was not valid JSON. Return ONLY the JSON object.'; continue; }

    // sanitize dashes everywhere as a safety net
    for (const k of ['display_title', 'seo_title', 'seo_description', 'body', 'alt_text']) {
      if (typeof data[k] === 'string') data[k] = killDashes(data[k]);
    }

    // validate
    const missing = ['display_title', 'seo_title', 'seo_description', 'body', 'alt_text', 'keywords']
      .filter((k) => !data[k] || (Array.isArray(data[k]) ? data[k].length === 0 : !String(data[k]).trim()));
    if (missing.length) { retryNote = `Missing fields: ${missing.join(', ')}. Include all keys.`; continue; }

    const blob = `${data.display_title} ${data.seo_title} ${data.seo_description} ${data.body}`;
    if (FORBIDDEN.test(blob)) { retryNote = 'Remove any mention of Etsy, marketplaces, donations, charity, or welfare. Rewrite cleanly.'; continue; }

    const key = normTitle(data.display_title);
    if (seen.has(key)) { retryNote = `The title "${data.display_title}" is already used by another product. Produce a clearly different, more specific title.`; continue; }

    seen.add(key);
    return data;
  }
  return null; // gave up after 3 attempts
}

// ---------- load global title set for uniqueness ----------
async function loadSeenTitles() {
  const seen = new Set();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('products').select('title, proposed_title').range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) {
      if (r.proposed_title) seen.add(normTitle(r.proposed_title));
    }
    if (data.length < 1000) break;
  }
  return seen;
}

// ---------- select products to process ----------
async function selectProducts() {
  let q = db.from('products')
    .select('id,title,slug,price_usd,image_url,description,seo_status,product_categories(categories(name,slug))')
    .eq('active', true)
    .not('image_url', 'is', null);
  if (SLUG) q = q.eq('slug', SLUG);
  if (CATEGORY) q = q.eq('product_categories.categories.slug', CATEGORY);
  q = q.order('title').limit(LIMIT * 3); // over-fetch; we filter client-side
  const { data, error } = await q;
  if (error) throw error;
  let rows = data || [];
  if (!FORCE) rows = rows.filter((r) => r.seo_status !== 'generated' && r.seo_status !== 'approved');
  if (ONLY_MISSING) rows = rows.filter((r) => !r.description || r.description.trim().length < 200);
  return rows.slice(0, LIMIT);
}

// ---------- main ----------
console.log(`Model: ${MODEL}`);
const seen = await loadSeenTitles();
console.log(`Loaded ${seen.size} existing proposed titles for uniqueness.`);
const products = await selectProducts();
console.log(`Generating SEO copy for ${products.length} product(s)…\n`);

let ok = 0, failed = 0;
for (const [i, p] of products.entries()) {
  process.stdout.write(`[${i + 1}/${products.length}] ${p.slug.slice(0, 50)} … `);
  try {
    const data = await generateOne(p, seen);
    if (!data) { console.log('✗ gave up after retries'); failed++; continue; }
    const { error } = await db.from('products').update({
      proposed_title: data.display_title,
      proposed_seo_title: data.seo_title,
      proposed_seo_description: data.seo_description,
      proposed_body: data.body,
      proposed_alt_text: data.alt_text,
      seo_keywords: data.keywords,
      seo_status: 'generated',
      seo_generated_at: new Date().toISOString(),
      original_title: p.title, // back up the pre-SEO title (overwrite-safe: only meaningful before approval)
    }).eq('id', p.id);
    if (error) { console.log('✗ db: ' + error.message); failed++; continue; }
    console.log('✓');
    ok++;
  } catch (e) {
    console.log('✗ ' + (e?.message || e));
    failed++;
  }
  await sleep(800); // gentle pacing
}

console.log(`\nDone. ${ok} generated, ${failed} failed.`);
console.log('Review them in admin → SEO Review (or run again to continue the catalog).');
