// Admin-only Subscriber Insights API. One route, four views:
//   ?view=overview                      → headline engagement + affinity stats
//   ?view=people&q=&sort=&dir=&page=    → per-subscriber engagement table
//   ?view=subscriber&email=…            → one person: event timeline + products they like
//   ?view=products&q=&page=             → product affinity table
//   ?view=product&product_id=…          → who is interested in one product (for targeting)
// Built on v_subscriber_engagement / v_product_interest + raw event/browse/order
// rows. Read-only. Service-role queries; caller must be an admin.
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail, sendBatch } from '../../../lib/resend';
import { productSpotlightEmail, type MiniProduct } from '../../../lib/marketing-emails';

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

const DAY = 86400000;
const slugFromUrl = (u: string | null): string | null => {
  if (!u) return null;
  const m = u.match(/\/product\/([^/?#]+)/);
  return m ? m[1] : null;
};

async function overview() {
  const db = supabaseAdmin();
  const { data: eng } = await db.from('v_subscriber_engagement')
    .select('email, source, opened, clicked, bounced, complained, last_opened_at, unsubscribed_at').limit(200000);
  const rows = eng || [];
  const now = Date.now();
  let engaged30 = 0, clickers = 0, dormant = 0, neverOpened = 0, bounced = 0, complained = 0, unsub = 0;
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    bySource[r.source || 'unknown'] = (bySource[r.source || 'unknown'] || 0) + 1;
    if (r.unsubscribed_at) unsub++;
    if (r.bounced) bounced++;
    if (r.complained) complained++;
    if (r.clicked) clickers++;
    const lo = r.last_opened_at ? new Date(r.last_opened_at).getTime() : 0;
    if (lo && now - lo <= 30 * DAY) engaged30++;
    else if (!lo) neverOpened++;
    else dormant++;
  }
  // product affinity headline
  const { data: prod } = await db.from('v_product_interest')
    .select('slug, title, image_url, email_clickers, browsers, buyers, interest_score')
    .order('interest_score', { ascending: false }).limit(10);
  return {
    total: rows.length, engaged30, clickers, dormant, neverOpened, bounced, complained, unsub,
    bySource: Object.entries(bySource).map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n),
    topProducts: prod || [],
  };
}

async function people(url: URL) {
  const db = supabaseAdmin();
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const sort = url.searchParams.get('sort') || 'last_event_at';
  const dir = (url.searchParams.get('dir') || 'desc') === 'asc';
  const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
  const size = Math.min(100, Number(url.searchParams.get('size')) || 50);
  const allowed = new Set(['last_event_at', 'opened', 'clicked', 'sent', 'joined_at', 'bounced', 'last_opened_at']);
  const sortCol = allowed.has(sort) ? sort : 'last_event_at';
  let query = db.from('v_subscriber_engagement')
    .select('email, source, joined_at, sent, delivered, opened, clicked, bounced, complained, last_opened_at, last_clicked_at, last_event_at, unsubscribed_at', { count: 'exact' });
  if (q) query = query.ilike('email', `%${q}%`);
  query = query.order(sortCol, { ascending: dir, nullsFirst: false }).range(page * size, page * size + size - 1);
  const { data, count } = await query;
  return { rows: data || [], total: count || 0, page, size };
}

async function subscriber(url: URL) {
  const db = supabaseAdmin();
  const email = (url.searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return { error: 'email required' };
  // event timeline (their "responses" to every email: opens, clicks, bounces…)
  const { data: events } = await db.from('email_events')
    .select('event, kind, url, created_at').eq('email', email)
    .order('created_at', { ascending: false }).limit(200);
  // product affinity for this person: clicks + browses + buys
  const interest = new Map<string, { slug: string; clicks: number; browses: number; buys: number }>();
  for (const e of events || []) {
    if (e.event === 'clicked') { const s = slugFromUrl(e.url); if (s) { const it = interest.get(s) || { slug: s, clicks: 0, browses: 0, buys: 0 }; it.clicks++; interest.set(s, it); } }
  }
  const { data: browses } = await db.from('browse_events').select('product_id, created_at').eq('email', email).limit(500);
  const { data: orders } = await db.from('orders').select('id, total, created_at, status').eq('email', email).is('deleted_at', null).order('created_at', { ascending: false }).limit(50);
  const orderIds = (orders || []).map((o) => o.id);
  let items: any[] = [];
  if (orderIds.length) {
    const { data: oi } = await db.from('order_items').select('product_id, title').in('order_id', orderIds);
    items = oi || [];
  }
  // resolve product ids → slugs/titles for browses + buys
  const pids = [...new Set([...(browses || []).map((b) => b.product_id), ...items.map((i) => i.product_id)].filter(Boolean))];
  const bySlug = new Map<string, { slug: string; clicks: number; browses: number; buys: number }>();
  for (const [, it] of interest) bySlug.set(it.slug, it);
  if (pids.length) {
    const { data: prods } = await db.from('products').select('id, slug').in('id', pids);
    const idToSlug = new Map((prods || []).map((p) => [p.id, p.slug]));
    for (const b of browses || []) { const s = idToSlug.get(b.product_id); if (s) { const it = bySlug.get(s) || { slug: s, clicks: 0, browses: 0, buys: 0 }; it.browses++; bySlug.set(s, it); } }
    for (const i of items) { const s = idToSlug.get(i.product_id); if (s) { const it = bySlug.get(s) || { slug: s, clicks: 0, browses: 0, buys: 0 }; it.buys++; bySlug.set(s, it); } }
  }
  // attach titles/images
  const slugs = [...bySlug.keys()];
  let meta = new Map<string, any>();
  if (slugs.length) {
    const { data: pm } = await db.from('products').select('slug, title, image_url, price_usd').in('slug', slugs);
    meta = new Map((pm || []).map((p) => [p.slug, p]));
  }
  const likes = [...bySlug.values()].map((it) => ({
    ...it, ...(meta.get(it.slug) || {}),
    score: it.buys * 5 + it.clicks * 2 + it.browses,
  })).sort((a, b) => b.score - a.score);
  const revenue = (orders || []).reduce((s, o) => s + (Number(o.total) || 0), 0);
  return { email, events: events || [], likes, orders: orders || [], revenue };
}

async function products(url: URL) {
  const db = supabaseAdmin();
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
  const size = Math.min(100, Number(url.searchParams.get('size')) || 50);
  let query = db.from('v_product_interest')
    .select('product_id, slug, title, image_url, price_usd, email_clickers, browsers, buyers, interest_score', { count: 'exact' });
  if (q) query = query.ilike('title', `%${q}%`);
  query = query.order('interest_score', { ascending: false }).range(page * size, page * size + size - 1);
  const { data, count } = await query;
  return { rows: data || [], total: count || 0, page, size };
}

async function productAudience(url: URL) {
  const db = supabaseAdmin();
  const productId = url.searchParams.get('product_id') || '';
  if (!productId) return { error: 'product_id required' };
  const { data: prod } = await db.from('products').select('id, slug, title').eq('id', productId).maybeSingle();
  if (!prod) return { error: 'product not found' };
  // clickers (email URL), browsers, buyers → union of interested emails
  const [{ data: clicks }, { data: browses }, { data: buys }] = await Promise.all([
    db.from('email_events').select('email').eq('event', 'clicked').ilike('url', `%/product/${prod.slug}%`).limit(5000),
    db.from('browse_events').select('email').eq('product_id', productId).limit(5000),
    db.from('order_items').select('order_id').eq('product_id', productId).limit(5000),
  ]);
  const emails = new Map<string, { email: string; clicked: boolean; browsed: boolean; bought: boolean }>();
  const touch = (e: string, k: 'clicked' | 'browsed' | 'bought') => {
    const em = (e || '').toLowerCase().trim(); if (!em) return;
    const r = emails.get(em) || { email: em, clicked: false, browsed: false, bought: false }; r[k] = true; emails.set(em, r);
  };
  for (const c of clicks || []) touch(c.email, 'clicked');
  for (const b of browses || []) touch(b.email, 'browsed');
  const buyOrderIds = (buys || []).map((b) => b.order_id);
  if (buyOrderIds.length) {
    const { data: os } = await db.from('orders').select('email').in('id', buyOrderIds).is('deleted_at', null).limit(5000);
    for (const o of os || []) touch(o.email, 'bought');
  }
  return { product: prod, audience: [...emails.values()] };
}

// ── Send a product to its interested audience ────────────────────────
const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// Build the sendable recipient list for a product: people who match a selected
// interest signal, are confirmed non-unsubscribed subscribers, never filed a
// spam complaint, and have not already been sent this product.
async function sendableFor(db: ReturnType<typeof supabaseAdmin>, productId: string, slug: string, seg: { clicked: boolean; browsed: boolean; bought: boolean }) {
  const want = new Map<string, boolean>();
  const add = (e?: string | null) => { const em = (e || '').toLowerCase().trim(); if (em) want.set(em, true); };
  const jobs: Promise<any>[] = [];
  if (seg.clicked) jobs.push(db.from('email_events').select('email').eq('event', 'clicked').ilike('url', `%/product/${slug}%`).limit(10000).then((r) => (r.data || []).forEach((x: any) => add(x.email))));
  if (seg.browsed) jobs.push(db.from('browse_events').select('email').eq('product_id', productId).limit(10000).then((r) => (r.data || []).forEach((x: any) => add(x.email))));
  if (seg.bought) jobs.push(db.from('order_items').select('order_id').eq('product_id', productId).limit(10000).then(async (r) => {
    const ids = (r.data || []).map((x: any) => x.order_id);
    for (const c of chunk(ids, 300)) { const { data } = await db.from('orders').select('email').in('id', c).is('deleted_at', null); (data || []).forEach((o: any) => add(o.email)); }
  }));
  await Promise.all(jobs);
  let cands = [...want.keys()];
  if (!cands.length) return [] as string[];

  // keep only confirmed, non-unsubscribed subscribers
  const sendable = new Set<string>();
  for (const c of chunk(cands, 300)) {
    const { data } = await db.from('subscribers').select('email, confirmed_at, unsubscribed_at').in('email', c);
    for (const s of data || []) if (s.confirmed_at && !s.unsubscribed_at) sendable.add(s.email.toLowerCase());
  }
  cands = [...sendable];
  if (!cands.length) return [];

  // drop anyone who ever filed a spam complaint
  for (const c of chunk(cands, 300)) {
    const { data } = await db.from('email_events').select('email').eq('event', 'complained').in('email', c);
    for (const r of data || []) sendable.delete((r.email || '').toLowerCase());
  }
  // drop anyone already sent this product
  for (const c of chunk([...sendable], 300)) {
    const { data } = await db.from('product_blast_log').select('email').eq('product_id', productId).in('email', c);
    for (const r of data || []) sendable.delete((r.email || '').toLowerCase());
  }
  const TEST = /fake|mailinator|@example\.|@test\.|\.invalid|localhost/i;
  return [...sendable].filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !TEST.test(e));
}

async function blast(request: Request, url: URL) {
  const db = supabaseAdmin();
  const body = await request.json().catch(() => ({}));
  const productId = String(body.product_id || '');
  if (!productId) return { error: 'product_id required' };
  const seg = { clicked: body.segments?.clicked !== false, browsed: body.segments?.browsed !== false, bought: !!body.segments?.bought };
  const { data: p } = await db.from('products').select('id, slug, title, image_url, price_usd').eq('id', productId).maybeSingle();
  if (!p) return { error: 'product not found' };
  const product = p as MiniProduct;

  // test send to one address, no dedup logging
  if (body.test) {
    const to = String(body.test).toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: 'valid test email required' };
    const { subject, html, text } = productSpotlightEmail({ email: to, product });
    const res = await sendEmail({ to, subject: `[TEST] ${subject}`, html, text, tags: [{ name: 'kind', value: 'product-blast' }] });
    return res.ok ? { tested: to } : { error: res.error || 'test failed' };
  }

  const recipients = await sendableFor(db, productId, p.slug, seg);
  if (!body.confirm) return { sendable: recipients.length, sample: recipients.slice(0, 8) };  // preview
  if (!recipients.length) return { sent: 0, note: 'nobody eligible (already sent, or not a confirmed subscriber)' };

  const tags = [{ name: 'kind', value: 'product-blast' }];
  let sent = 0, failed = 0;
  for (const batch of chunk(recipients, 100)) {
    const emails = batch.map((email) => { const { subject, html, text } = productSpotlightEmail({ email, product }); return { to: email, subject, html, text, tags }; });
    const idem = 'product-blast:' + createHash('sha256').update(productId + '|' + [...batch].sort().join(',')).digest('hex').slice(0, 28);
    const res = await sendBatch(emails, idem);
    if (res.ok) { sent += res.sent; await db.from('product_blast_log').upsert(batch.map((email) => ({ product_id: productId, email })), { onConflict: 'product_id,email', ignoreDuplicates: true }); }
    else failed += batch.length;
  }
  return { sent, failed };
}

export const POST: APIRoute = async ({ request, url }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const out = await blast(request, url);
    return json({ ok: !out.error, ...out }, out.error ? 400 : 200);
  } catch (e: any) {
    return json({ error: e?.message || 'blast failed' }, 500);
  }
};

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const view = url.searchParams.get('view') || 'overview';
  try {
    let out: any;
    if (view === 'overview') out = await overview();
    else if (view === 'people') out = await people(url);
    else if (view === 'subscriber') out = await subscriber(url);
    else if (view === 'products') out = await products(url);
    else if (view === 'product') out = await productAudience(url);
    else return json({ error: 'unknown view' }, 400);
    return json({ ok: true, ...out });
  } catch (e: any) {
    return json({ error: e?.message || 'insights failed' }, 500);
  }
};
