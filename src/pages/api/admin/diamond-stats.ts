// Admin: Diamond Select at a glance (Admin > Membership > Diamond Select).
// Per member: credits earned, used and left, what they picked, downloads and
// countries, plus two warnings: possible sharing (one design downloaded many
// times, or downloads from 3+ countries in 7 days) and idle credits (20+ left
// and nothing picked for 30 days). For the plan: most chosen designs and
// collections, which doubles as demand research.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { DIAMOND_SLUG, DIAMOND_CREDITS_PER_MONTH, DIAMOND_GRACE_DAYS, monthsStarted } from '../../../lib/diamond-select';
import { addDays, todayYMD } from '../../../lib/subscriptions';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

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

export const GET: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const db = supabaseAdmin();
  const today = todayYMD();
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const month = new Date(Date.now() - 30 * 864e5).toISOString();

  const [{ data: plan }, { data: terms }, { data: ents }, { data: dls }] = await Promise.all([
    db.from('membership_plans').select('name, price_usd, available_from, active').eq('slug', DIAMOND_SLUG).maybeSingle(),
    db.from('member_subscriptions').select('id, email, customer_name, start_date, end_date, months, status, price_usd, renewed_to, created_at').eq('plan_slug', DIAMOND_SLUG).order('start_date', { ascending: false }).limit(1000),
    db.from('entitlements').select('email, product_id, granted_at').eq('source', DIAMOND_SLUG).order('granted_at', { ascending: false }).limit(20000),
    db.from('member_downloads').select('email, product_id, country, ip_hash, ts').order('ts', { ascending: false }).limit(20000),
  ]);
  const E = ents || [], D = dls || [];
  const lc = (s: string) => String(s || '').toLowerCase();

  const members = (terms || []).map((t: any) => {
    const email = lc(t.email);
    const started = monthsStarted({ start_date: t.start_date, months: Number(t.months) || 12 }, today);
    const earned = t.start_date <= today ? started * DIAMOND_CREDITS_PER_MONTH : 0;
    const mine = E.filter((e: any) => lc(e.email) === email && e.granted_at >= t.start_date);
    const myDl = D.filter((d: any) => lc(d.email) === email && d.ts >= t.start_date);
    const perDesign = new Map<string, number>();
    for (const d of myDl) perDesign.set(d.product_id, (perDesign.get(d.product_id) || 0) + 1);
    const maxSame = Math.max(0, ...perDesign.values());
    const countries7 = new Set(myDl.filter((d: any) => d.ts >= week && d.country).map((d: any) => d.country));
    const lastPick = mine[0]?.granted_at || null;
    const left = Math.max(0, earned - mine.length);
    const flags: string[] = [];
    if (maxSame >= 6) flags.push(`one design downloaded ${maxSame} times`);
    if (countries7.size >= 3) flags.push(`downloads from ${countries7.size} countries this week`);
    if (left >= 20 && (!lastPick || lastPick < month) && t.status === 'active') flags.push(`${left} credits unused, no pick for 30+ days`);
    return {
      email, name: t.customer_name, status: t.status, start: t.start_date, end: t.end_date, lastDay: addDays(t.end_date, DIAMOND_GRACE_DAYS),
      price: Number(t.price_usd) || 0, earned, used: mine.length, left, total: (Number(t.months) || 12) * DIAMOND_CREDITS_PER_MONTH,
      lastPick, downloads: myDl.length, countries: [...new Set(myDl.map((d: any) => d.country).filter(Boolean))],
      renewed: !!t.renewed_to, flags,
    };
  });

  // most chosen designs and their collections
  const pickCount = new Map<string, number>();
  for (const e of E) pickCount.set(e.product_id, (pickCount.get(e.product_id) || 0) + 1);
  const topIds = [...pickCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id);
  let topDesigns: any[] = [], collections: { name: string; picks: number }[] = [];
  if (pickCount.size) {
    const allIds = [...pickCount.keys()];
    const { data: prods } = await db.from('products').select('id, title, slug, image_url, product_categories(categories(name))').in('id', allIds.slice(0, 1000));
    const byId = new Map((prods || []).map((p: any) => [p.id, p]));
    topDesigns = topIds.map((id) => { const p: any = byId.get(id) || {}; return { id, title: String(p.title || '').split('|')[0].trim(), slug: p.slug, image: p.image_url, picks: pickCount.get(id) }; });
    const cm = new Map<string, number>();
    for (const [id, n] of pickCount) for (const c of ((byId.get(id) as any)?.product_categories || [])) { const name = c.categories?.name; if (name) cm.set(name, (cm.get(name) || 0) + n); }
    collections = [...cm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, picks]) => ({ name, picks }));
  }

  const active = members.filter((m) => m.status === 'active' && m.start <= today && m.end >= today);
  const earnedAll = members.reduce((s, m) => s + m.earned, 0), usedAll = members.reduce((s, m) => s + m.used, 0);
  const in30 = addDays(today, 30);
  return json({
    plan: plan ? { name: plan.name, price: Number(plan.price_usd), launched: !!plan.active && (!plan.available_from || String(plan.available_from) <= today), availableFrom: plan.available_from } : null,
    totals: {
      members: members.length, active: active.length,
      revenue: members.reduce((s, m) => s + m.price, 0),
      creditsEarned: earnedAll, creditsUsed: usedAll, usedPct: earnedAll ? Math.round((usedAll / earnedAll) * 100) : 0,
      downloads: D.length, renewalsDue: active.filter((m) => m.end <= in30 && !m.renewed).length,
      flagged: members.filter((m) => m.flags.length).length,
    },
    members, topDesigns, collections,
  });
};
