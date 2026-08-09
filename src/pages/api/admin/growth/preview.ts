// Admin-only: render any marketing/automation email with REAL store data so the
// owner can review every template before enabling the systems, and test-send
// any of them to their own inbox. GET ?kind=… → {subject, html}; POST {kind, to}.

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../../lib/supabase';
import { send as sendEmail } from '../../../../lib/resend';
import { dripEmail, cartReminderEmail, reviewRequestEmail, newArrivalsEmail, loyaltyEmail, weeklyDigestEmail, abandonedBrowseEmail, etsyWelcomeEmail, applyOverride, TEMPLATE_HEADINGS, type MiniProduct } from '../../../../lib/marketing-emails';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  const { data: prof } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

const KINDS = ['drip1', 'drip2', 'drip3', 'drip4', 'drip5', 'cart', 'browse', 'review7', 'arrivals30', 'loyalty', 'weekly', 'etsyWelcome'] as const;

async function render(kind: string, email: string): Promise<{ subject: string; html: string; text: string }> {
  const db = supabaseAdmin();
  const [{ data: best }, { data: bundle }, { data: plan }, { data: newest }] = await Promise.all([
    db.from('products').select('title, slug, image_url, price_usd').eq('active', true).eq('is_bestseller', true).limit(3),
    db.from('products').select('title, slug, image_url, price_usd').eq('active', true).eq('is_bundle', true).order('price_usd', { ascending: false }).limit(1).maybeSingle(),
    db.from('membership_plans').select('name, months, files_per_month, price_usd').eq('active', true).order('sort_order').limit(1).maybeSingle(),
    db.from('products').select('title, slug, image_url, price_usd').eq('active', true).order('created_at', { ascending: false }).limit(3),
  ]);
  let bestsellers = (best || []) as MiniProduct[];
  if (!bestsellers.length) bestsellers = (newest || []) as MiniProduct[];

  let out: { subject: string; html: string; text: string };
  if (kind.startsWith('drip')) {
    const stage = Number(kind.slice(4)) || 1;
    out = dripEmail(stage, { email, bestsellers, bundle: bundle as MiniProduct | null, plan: plan as any, couponCode: 'CARVE15' });
  } else if (kind === 'cart') {
    const items = bestsellers.slice(0, 2).map((b) => ({ title: b.title, price: Number(b.price_usd) || 7.99, image_url: b.image_url, slug: b.slug }));
    out = cartReminderEmail({ email, items: items.length ? items : [{ title: 'Sample Bas-Relief STL', price: 7.99 }], subtotal: items.reduce((s, i) => s + i.price, 0) });
  } else if (kind === 'browse') out = abandonedBrowseEmail({ email, products: (bestsellers.length ? bestsellers : newest || []) as MiniProduct[] });
  else if (kind === 'review7') out = reviewRequestEmail({ email, name: 'Sample Customer', itemTitles: [bestsellers[0]?.title || 'Sample Bas-Relief STL'] });
  else if (kind === 'arrivals30') out = newArrivalsEmail({ email, name: 'Sample Customer', products: (newest || []) as MiniProduct[] });
  else if (kind === 'loyalty') out = loyaltyEmail({ email, name: 'Sample Customer', code: 'LOYAL-DEMO' });
  else if (kind === 'weekly') {
    // preview with this week's products; fall back to the newest 6 so the
    // owner always sees a populated layout
    const { data: week } = await db.from('products').select('title, slug, image_url, price_usd, created_at')
      .eq('active', true).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
      .order('created_at', { ascending: false }).limit(60);
    const { data: fb } = week?.length ? { data: null } : await db.from('products')
      .select('title, slug, image_url, price_usd, created_at').eq('active', true)
      .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
      .order('created_at', { ascending: false }).limit(6);
    const pool = ((week?.length ? week : fb) || []) as any[];
    const fmtDay = (x: string) => new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let range: string | undefined;
    if (pool.length) {
      const sD = fmtDay(pool[pool.length - 1].created_at || new Date().toISOString());
      const eD = fmtDay(pool[0].created_at || new Date().toISOString());
      range = sD === eD ? sD : `${sD} – ${eD}`;
    }
    out = weeklyDigestEmail({ email, products: pool as MiniProduct[], weekNumber: Math.floor(Date.now() / 604800000), range });
  }
  else if (kind === 'etsyWelcome') {
    // preview with this week's newest 12 designs + the true count for the link
    const sinceIso = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ data: fresh }, { count }] = await Promise.all([
      db.from('products').select('title, slug, image_url, price_usd')
        .eq('active', true).gte('created_at', sinceIso)
        .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
        .order('created_at', { ascending: false }).limit(12),
      db.from('products').select('id', { count: 'exact', head: true })
        .eq('active', true).gte('created_at', sinceIso)
        .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null),
    ]);
    const products = (fresh?.length ? fresh : newest || []) as MiniProduct[];
    out = etsyWelcomeEmail({ email, products, totalNew: count || products.length, code: 'THANKYOU10' });
  }
  else throw new Error('unknown kind');

  // owner-saved edits (subject / heading / body) apply to preview + test-sends
  const { data: ov } = await db.from('email_template_overrides').select('*').eq('kind', kind).maybeSingle();
  return applyOverride(out, ov as any, email, TEMPLATE_HEADINGS[kind] || '');
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const kind = url.searchParams.get('kind') || 'drip1';
  if (!KINDS.includes(kind as any)) return json({ error: 'unknown kind' }, 400);
  try {
    const out = await render(kind, 'preview@example.com');
    return json({ ok: true, kind, subject: out.subject, html: out.html });
  } catch (e: any) { return json({ error: e?.message || 'render failed' }, 500); }
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const kind = String(body.kind || '');
    const to = String(body.to || '').toLowerCase().trim();
    if (!KINDS.includes(kind as any)) return json({ error: 'unknown kind' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: 'valid "to" email required' }, 400);
    const { subject, html, text } = await render(kind, to);
    const res = await sendEmail({ to, subject: `[TEST] ${subject}`, html, text });
    return res.ok ? json({ ok: true, sent: to }) : json({ error: res.error || 'send failed' }, 502);
  } catch (e: any) { return json({ error: e?.message || 'test send failed' }, 500); }
};
