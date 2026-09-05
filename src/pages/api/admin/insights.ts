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
import { fetchAll } from '../../../lib/fetch-all';
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
  const { data: eng } = await fetchAll((a, b) => db.from('v_subscriber_engagement')
    .select('email, source, sent, delivered, opened, clicked, bounced, complained, last_opened_at, unsubscribed_at').range(a, b)).then((data) => ({ data }));
  const rows = eng || [];
  const now = Date.now();
  let engaged30 = 0, clickers = 0, dormant = 0, neverOpened = 0, bounced = 0, complained = 0, unsub = 0;
  let tSent = 0, tDelivered = 0, tOpened = 0, tClicked = 0, tBounced = 0, tComplained = 0;
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    bySource[r.source || 'unknown'] = (bySource[r.source || 'unknown'] || 0) + 1;
    if (r.unsubscribed_at) unsub++;
    if (r.bounced) bounced++;
    if (r.complained) complained++;
    if (r.clicked) clickers++;
    tSent += r.sent || 0; tDelivered += r.delivered || 0; tOpened += r.opened || 0;
    tClicked += r.clicked || 0; tBounced += r.bounced || 0; tComplained += r.complained || 0;
    const lo = r.last_opened_at ? new Date(r.last_opened_at).getTime() : 0;
    if (lo && now - lo <= 30 * DAY) engaged30++;
    else if (!lo) neverOpened++;
    else dormant++;
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const { count: suppressed } = await db.from('subscribers').select('email', { count: 'exact', head: true }).not('suppressed_at', 'is', null);
  const health = {
    sent: tSent, deliveryRate: pct(tDelivered, tSent), openRate: pct(tOpened, tDelivered),
    clickRate: pct(tClicked, tDelivered), bounceRate: pct(tBounced, tSent), complaintRate: pct(tComplained, tDelivered),
    suppressed: suppressed || 0,
  };
  // product affinity headline
  const { data: prod } = await db.from('v_product_interest')
    .select('slug, title, image_url, email_clickers, browsers, buyers, interest_score')
    .order('interest_score', { ascending: false }).limit(10);

  // most-clicked designs in the last 7 days (from email link clicks)
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  const { data: recentClicks } = await fetchAll((a, b) => db.from('email_events')
    .select('url, email').eq('event', 'clicked').gte('created_at', weekAgo).range(a, b)).then((data) => ({ data }));
  const clickAgg = new Map<string, Set<string>>();  // slug → unique emails
  for (const c of recentClicks || []) {
    const s = slugFromUrl(c.url); if (!s) continue;
    (clickAgg.get(s) || clickAgg.set(s, new Set()).get(s)!).add((c.email || '').toLowerCase());
  }
  const ranked = [...clickAgg.entries()].map(([slug, set]) => ({ slug, clicks: set.size })).sort((a, b) => b.clicks - a.clicks).slice(0, 8);
  let mostClickedWeek: any[] = [];
  if (ranked.length) {
    const { data: pm } = await db.from('products').select('id, slug, title, image_url, price_usd').in('slug', ranked.map((r) => r.slug));
    const bySlug = new Map((pm || []).map((p) => [p.slug, p]));
    mostClickedWeek = ranked.map((r) => ({ ...r, ...(bySlug.get(r.slug) || {}) })).filter((r) => r.id);
  }

  return {
    total: rows.length, engaged30, clickers, dormant, neverOpened, bounced, complained, unsub, health,
    bySource: Object.entries(bySource).map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n),
    topProducts: prod || [], mostClickedWeek,
  };
}

// ── Hot leads: RFM-scored subscribers most likely to buy ─────────────
async function leads(url: URL) {
  const db = supabaseAdmin();
  const { data } = await db.from('v_subscriber_rfm').select('email, source, orders, revenue, last_order_at, last_open_at, joined_at').limit(50000);
  const now = Date.now();
  const scored = (data || []).map((r) => {
    const recencyDays = Math.floor((now - new Date(r.last_order_at || r.last_open_at || r.joined_at).getTime()) / DAY);
    const R = recencyDays <= 14 ? 5 : recencyDays <= 45 ? 4 : recencyDays <= 90 ? 3 : recencyDays <= 180 ? 2 : 1;
    const F = r.orders >= 5 ? 5 : r.orders >= 3 ? 4 : r.orders >= 2 ? 3 : r.orders >= 1 ? 2 : 1;
    const rev = Number(r.revenue) || 0;
    const M = rev >= 100 ? 5 : rev >= 50 ? 4 : rev >= 20 ? 3 : rev > 0 ? 2 : 1;
    return { ...r, recencyDays, score: R * 100 + F * 10 + M, R, F, M };
  }).sort((a, b) => b.score - a.score).slice(0, 100);
  return { rows: scored };
}

// ── Referral leaderboard ─────────────────────────────────────────────
async function referrals() {
  const db = supabaseAdmin();
  const { data } = await db.from('v_referral_leaderboard').select('referrer_email, referred, rewarded, revenue').order('referred', { ascending: false }).limit(100);
  return { rows: data || [] };
}

// ── Related designs: customers who liked X also liked Y ──────────────
async function related(url: URL) {
  const db = supabaseAdmin();
  const productId = url.searchParams.get('product_id') || '';
  const { data: prod } = await db.from('products').select('id, slug').eq('id', productId).maybeSingle();
  if (!prod) return { error: 'product not found' };
  // audience interested in THIS product (browsed/bought/clicked)
  const A = new Set<string>();
  const [{ data: br }, { data: cl }, { data: oi }] = await Promise.all([
    db.from('browse_events').select('email').eq('product_id', productId).limit(5000),
    db.from('email_events').select('email').eq('event', 'clicked').ilike('url', `%/product/${prod.slug}%`).limit(5000),
    db.from('order_items').select('order_id').eq('product_id', productId).limit(5000),
  ]);
  for (const r of br || []) A.add((r.email || '').toLowerCase());
  for (const r of cl || []) A.add((r.email || '').toLowerCase());
  for (const c of chunk((oi || []).map((x) => x.order_id), 300)) { const { data } = await db.from('orders').select('email').in('id', c).is('deleted_at', null); (data || []).forEach((o) => A.add((o.email || '').toLowerCase())); }
  const audience = [...A].filter(Boolean).slice(0, 800);
  if (!audience.length) return { related: [] };
  // other products that same audience engaged with (browse + buy), by distinct people
  const tally = new Map<string, Set<string>>();  // productId → emails
  for (const c of chunk(audience, 300)) {
    const { data: b2 } = await db.from('browse_events').select('email, product_id').in('email', c).limit(20000);
    for (const r of b2 || []) if (r.product_id && r.product_id !== productId) (tally.get(r.product_id) || tally.set(r.product_id, new Set()).get(r.product_id)!).add((r.email || '').toLowerCase());
  }
  // buys by the audience
  for (const c of chunk(audience, 300)) {
    const { data: os } = await db.from('orders').select('id, email').in('email', c).is('deleted_at', null).limit(20000);
    const idToEmail = new Map((os || []).map((o) => [o.id, (o.email || '').toLowerCase()]));
    const oids = [...idToEmail.keys()];
    for (const c2 of chunk(oids, 300)) {
      const { data: its } = await db.from('order_items').select('order_id, product_id').in('order_id', c2).limit(20000);
      for (const it of its || []) if (it.product_id && it.product_id !== productId) (tally.get(it.product_id) || tally.set(it.product_id, new Set()).get(it.product_id)!).add(idToEmail.get(it.order_id) || '');
    }
  }
  const ranked = [...tally.entries()].map(([pid, set]) => ({ product_id: pid, shared: set.size })).sort((a, b) => b.shared - a.shared).slice(0, 8);
  if (!ranked.length) return { related: [] };
  const { data: pm } = await db.from('products').select('id, slug, title, image_url, price_usd').in('id', ranked.map((r) => r.product_id));
  const meta = new Map((pm || []).map((p) => [p.id, p]));
  return { related: ranked.map((r) => ({ ...r, ...(meta.get(r.product_id) || {}) })).filter((r) => r.slug) };
}

async function suppressBounced() {
  const db = supabaseAdmin();
  // everyone with a hard bounce or spam complaint, not already suppressed
  const bad = new Set<string>();
  for (const ev of ['bounced', 'complained']) {
    const { data } = await fetchAll((a, b) => db.from('email_events').select('email').eq('event', ev).range(a, b)).then((data) => ({ data }));
    for (const r of data || []) if (r.email) bad.add(r.email.toLowerCase());
  }
  const emails = [...bad];
  let suppressed = 0;
  for (const c of chunk(emails, 200)) {
    const { data } = await db.from('subscribers').update({ suppressed_at: new Date().toISOString() }).in('email', c).is('suppressed_at', null).select('email');
    suppressed += (data || []).length;
  }
  return { suppressed };
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

  // ── LTV + next-purchase prediction ─────────────────────────────────
  // avg gap between paid orders → predicted next window (only meaningful with
  // 2+ orders; single-order buyers get spend + tenure only).
  const paidOrders = (orders || []).filter((o: any) => o.status === 'paid')
    .map((o: any) => ({ t: Date.parse(o.created_at), total: Number(o.total) || 0 }))
    .sort((a, b) => a.t - b.t);
  let ltv: any = null;
  if (paidOrders.length) {
    const spend = paidOrders.reduce((s, o) => s + o.total, 0);
    const first = paidOrders[0].t, last = paidOrders[paidOrders.length - 1].t;
    const tenureDays = Math.max(1, Math.round((Date.now() - first) / 86400000));
    const perYear = +(spend * 365 / tenureDays).toFixed(2);
    let avgGapDays: number | null = null, nextWindow: string | null = null, overdue = false;
    if (paidOrders.length >= 2) {
      avgGapDays = Math.round((last - first) / 86400000 / (paidOrders.length - 1));
      const due = last + avgGapDays * 86400000;
      nextWindow = new Date(due).toISOString().slice(0, 10);
      overdue = due < Date.now();
    }
    ltv = { spend: +spend.toFixed(2), orders: paidOrders.length, avgOrder: +(spend / paidOrders.length).toFixed(2), perYear, tenureDays, avgGapDays, nextWindow, overdue, lastOrderAt: new Date(last).toISOString().slice(0, 10) };
  }
  return { email, events: events || [], likes, orders: orders || [], revenue, ltv };
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
  return hygieneFilter(db, productId, [...want.keys()]);
}

// Shared hygiene pipeline: confirmed non-unsubscribed subscribers only, no
// spam complainers, nobody already sent this product, no obvious test inboxes.
async function hygieneFilter(db: ReturnType<typeof supabaseAdmin>, productId: string, candsIn: string[]) {
  let cands = [...new Set(candsIn.map((e) => (e || '').toLowerCase().trim()).filter(Boolean))];
  if (!cands.length) return [] as string[];
  const sendable = new Set<string>();
  for (const c of chunk(cands, 300)) {
    const { data } = await db.from('subscribers').select('email, confirmed_at, unsubscribed_at').in('email', c);
    for (const s of data || []) if (s.confirmed_at && !s.unsubscribed_at) sendable.add(s.email.toLowerCase());
  }
  cands = [...sendable];
  if (!cands.length) return [];
  for (const c of chunk(cands, 300)) {
    const { data } = await db.from('email_events').select('email').eq('event', 'complained').in('email', c);
    for (const r of data || []) sendable.delete((r.email || '').toLowerCase());
  }
  for (const c of chunk([...sendable], 300)) {
    const { data } = await db.from('product_blast_log').select('email').eq('product_id', productId).in('email', c);
    for (const r of data || []) sendable.delete((r.email || '').toLowerCase());
  }
  const TEST = /fake|mailinator|@example\.|@test\.|\.invalid|localhost/i;
  return [...sendable].filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !TEST.test(e));
}

// ── Quick segments — one-click audiences relative to the chosen product ──
//   carted_no_buy    people who built a cart but never completed any order
//   category_fans    people who browsed/hearted designs in this product's categories
//   category_buyers  people who own designs from this product's categories
async function segmentCandidates(db: ReturnType<typeof supabaseAdmin>, productId: string, kind: string): Promise<string[]> {
  const emails = new Set<string>();
  const add = (e?: string | null) => { const em = (e || '').toLowerCase().trim(); if (em) emails.add(em); };
  if (kind === 'carted_no_buy') {
    const { data: carts } = await db.from('abandoned_carts').select('email').limit(10000);
    (carts || []).forEach((r: any) => add(r.email));
    // remove anyone who has EVER completed an order
    for (const c of chunk([...emails], 300)) {
      const { data } = await db.from('orders').select('email').eq('status', 'paid').in('email', c);
      for (const r of data || []) emails.delete((r.email || '').toLowerCase());
    }
    return [...emails];
  }
  // category-scoped kinds: collect the product's categories → their products
  const { data: pcs } = await db.from('product_categories').select('category_id').eq('product_id', productId);
  const catIds = [...new Set((pcs || []).map((r: any) => r.category_id))];
  if (!catIds.length) return [];
  const { data: catProds } = await db.from('product_categories').select('product_id').in('category_id', catIds).limit(3000);
  const prodIds = [...new Set((catProds || []).map((r: any) => r.product_id))];
  if (!prodIds.length) return [];
  if (kind === 'category_fans') {
    for (const c of chunk(prodIds, 200)) {
      const { data } = await db.from('browse_events').select('email').in('product_id', c).limit(10000);
      (data || []).forEach((r: any) => add(r.email));
    }
  } else if (kind === 'category_buyers') {
    for (const c of chunk(prodIds, 200)) {
      const { data } = await db.from('entitlements').select('email').in('product_id', c).limit(10000);
      (data || []).forEach((r: any) => add(r.email));
    }
  }
  return [...emails];
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

  // Quick-segment override: body.segment picks a one-click audience instead of
  // the product's own interest signals; same hygiene + per-product dedupe.
  const segmentKind = String(body.segment || '');
  const recipients = ['carted_no_buy', 'category_fans', 'category_buyers'].includes(segmentKind)
    ? await hygieneFilter(db, productId, await segmentCandidates(db, productId, segmentKind))
    : await sendableFor(db, productId, p.slug, seg);
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
    // peek at the action without consuming the body twice
    const raw = await request.text();
    const body = raw ? JSON.parse(raw) : {};
    if (body.action === 'suppress_bounced') { const out = await suppressBounced(); return json({ ok: true, ...out }); }
    const out = await blast(new Request(request.url, { method: 'POST', headers: request.headers, body: raw }), url);
    return json({ ok: !out.error, ...out }, out.error ? 400 : 200);
  } catch (e: any) {
    return json({ error: e?.message || 'action failed' }, 500);
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
    else if (view === 'leads') out = await leads(url);
    else if (view === 'referrals') out = await referrals();
    else if (view === 'related') out = await related(url);
    else return json({ error: 'unknown view' }, 400);
    return json({ ok: true, ...out });
  } catch (e: any) {
    return json({ error: e?.message || 'insights failed' }, 500);
  }
};
