// Lightweight AI design concierge. Answers shop/compatibility questions and
// recommends REAL designs from the catalog, grounded so it can't invent products
// or prices. Uses Claude Haiku (fast + cheap) via the Anthropic SDK. Rate-limited.
import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const env = (n: string) => process.env[n] ?? (import.meta as any).env?.[n];

const SITE = 'https://digitalchiselco.com';
const SYSTEM = `You are the friendly design concierge for DigitalChiselCo, a shop that sells premium bas-relief STL design files for CNC routers, laser engravers and 3D printers.

Facts you can rely on:
- Products are INSTANT digital downloads (STL files) emailed right after purchase. No physical shipping.
- Files work with Aspire, VCarve Pro, Carveco, ArtCAM and Fusion 360, and print on FDM/resin 3D printers.
- Every design includes a personal & commercial-use license and unlimited re-downloads.
- New designs are added weekly. There is a membership with a monthly file library, and gift cards.
- First-order discount code: THANKYOU10 (10% off), entered in the cart promo box.
- Refunds: digital goods, handled case-by-case; point people to jolly@digitalchiselco.com for anything you cannot resolve.

Rules:
- Be warm, brief and helpful (2-4 sentences). Never invent products, prices, links, or policies.
- Recommend ONLY designs from the "Relevant designs" list provided in the user turn; link them as ${SITE}/product/<slug>. If none fit, suggest browsing ${SITE}/catalog or ${SITE}/designs.
- You cannot process orders, payments, refunds, or accounts. For those, direct to the cart, the account page, or jolly@digitalchiselco.com.
- If asked something unrelated to the shop, gently steer back to designs and carving.`;

async function relevantProducts(q: string) {
  const words = (q.toLowerCase().match(/[a-z]{3,}/g) || [])
    .filter((w) => !['the', 'and', 'for', 'you', 'have', 'with', 'stl', 'file', 'files', 'design', 'designs', 'cnc', 'want', 'need', 'looking', 'something', 'recommend'].includes(w))
    .slice(0, 6);
  if (!words.length) return [];
  const { data } = await supabase.from('products').select('title, slug, price_usd')
    .eq('active', true).not('image_url', 'is', null)
    .or(words.map((w) => `title.ilike.%${w}%`).join(','))
    .order('is_bestseller', { ascending: false }).limit(6);
  return data || [];
}

export const POST: APIRoute = async ({ request }) => {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'Concierge is not configured yet.' }, 503);
  const ip = clientIp(request);
  if (!(await rateLimit(`concierge:ip:${ip}`, 20, 3600))) return tooMany();

  const body = await request.json().catch(() => ({}));
  const history = Array.isArray(body.messages) ? body.messages : [];
  // keep it lightweight: last 8 turns, text only, capped length
  const msgs = history.slice(-8)
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 1500) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json({ error: 'Ask me anything about the designs!' }, 400);

  // ground the final user turn with real matching products
  const lastUser = msgs[msgs.length - 1].content;
  const prods = await relevantProducts(lastUser);
  if (prods.length) {
    const list = prods.map((p) => `- ${String(p.title).split('|')[0].trim()} | $${Number(p.price_usd).toFixed(2)} | ${SITE}/product/${p.slug}`).join('\n');
    msgs[msgs.length - 1] = { role: 'user', content: `${lastUser}\n\nRelevant designs (recommend only from these, or suggest browsing):\n${list}` };
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: SYSTEM,
      messages: msgs,
    });
    const text = resp.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('').trim();
    return json({ ok: true, reply: text || "I'm here to help with our designs — what are you carving?" });
  } catch (e: any) {
    console.error('[concierge]', e?.message);
    return json({ error: 'The concierge is busy right now. Please try again, or email jolly@digitalchiselco.com.' }, 502);
  }
};
