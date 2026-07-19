// Feature 3 — AI-written story for a Customer Creation.
// The admin adds a buyer's shared photo + their name; this generates a short,
// warm story (in the DigitalChiselCo house voice) that goes into the creation's
// `description`, shown on the homepage "Carved by you" gallery. Admin-gated.
//
// Needs ANTHROPIC_API_KEY in the server env (already present).

import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || import.meta.env.ANTHROPIC_API_KEY || '';
const MODEL = 'claude-opus-4-8';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  const admin = supabaseAdmin();
  const { data: prof } = await admin.from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

// Right-size a Supabase-stored image so vision tokens stay small.
function renderUrl(url: string) {
  if (!url || !url.includes('/storage/v1/object/public/')) return url;
  return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=800&quality=80';
}
function killDashes(s: string) {
  return String(s || '').replace(/\s*[—–]\s*/g, ', ').replace(/, ,/g, ',').replace(/ {2,}/g, ' ');
}

const SYSTEM = `You write short "customer creation" stories for DigitalChiselCo, a shop selling downloadable STL files for CNC routers, laser engravers and 3D printers (bas-relief wood-carving designs). A real customer has shared a photo of the piece they carved or printed from one of our files.

Study the IMAGE first if one is given: it is the source of truth for what they made and the material. Write a warm, genuine 2 to 4 sentence story that celebrates THEIR craftsmanship, mentions what they made and (from the image) the material or finish, and feels human and specific, not like an ad.

Hard rules:
- Never use em-dashes or en-dashes. Use commas or periods.
- Never write "Etsy", "marketplace", or mention any other shop, price, or donations.
- Do not invent facts you cannot see. Keep it believable.
- Warm, plain English. No corporate filler, no "elevate", no "look no further".
- Refer to the maker by their first name naturally at least once.

Return ONLY the story text, no quotes, no preamble.`;

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'unauthorized' }, 401);
  if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }, 503);

  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }
  const name = String(body.name || '').trim();
  const productTitle = String(body.product_title || '').trim();
  const notes = String(body.notes || '').trim();
  const imageUrl = String(body.image_url || '').trim();
  if (!name) return json({ error: 'A maker name is required.' }, 400);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY, maxRetries: 4 });
  const text =
    `Maker's first name: ${name}\n` +
    (productTitle ? `Design they used: ${productTitle}\n` : '') +
    (notes ? `Notes from the maker or admin: ${notes}\n` : '') +
    `Write their creation story.`;
  const content: any[] = [];
  if (imageUrl) content.push({ type: 'image', source: { type: 'url', url: renderUrl(imageUrl) } });
  content.push({ type: 'text', text });

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    const block = res.content.find((b: any) => b.type === 'text') as any;
    const story = killDashes((block?.text || '').trim()).replace(/^["'](.*)["']$/s, '$1').trim();
    if (!story) return json({ error: 'The model returned no story. Try again.' }, 502);
    return json({ ok: true, story });
  } catch (e: any) {
    return json({ error: 'AI request failed', detail: String(e?.message || e) }, 502);
  }
};
