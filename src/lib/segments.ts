// Responsiveness segments (owner 2026-09-06). ONE definition shared by the
// Insights > Segments dashboard, the send-to-audience tool and scripts:
//   hot   clicked an email or bought in the last 30 days
//   warm  opened in the last 30 days
//   cool  opened before that (31 to 180 days)
//   new   never opened and fewer than 6 emails so far (too early to judge)
//   cold  never opened after 6+ emails, or no open for 180+ days
// Unsubscribed, unconfirmed, suppressed, bounced or complaining people are 'out'.
import { fetchAll } from './fetch-all';
import type { supabaseAdmin } from './supabase';

const DAY = 86400000;
export type Tier = 'hot' | 'warm' | 'cool' | 'new' | 'cold';
export const TIERS: Tier[] = ['hot', 'warm', 'cool', 'new', 'cold'];
export type EngRow = { email: string; source: string | null; joined_at: string; sent: number; opened: number; clicked: number; bounced: number; complained: number; last_opened_at: string | null; last_clicked_at: string | null; unsubscribed_at: string | null; orders: number; revenue: number; last_order_at: string | null; tier: Tier | 'out' };
type DB = ReturnType<typeof supabaseAdmin>;

export async function engagementRows(db: DB): Promise<EngRow[]> {
  const [{ data: eng }, { data: rfm }, { data: sup }] = await Promise.all([
    fetchAll((a, b) => db.from('v_subscriber_engagement').select('email, source, joined_at, sent, opened, clicked, bounced, complained, last_opened_at, last_clicked_at, unsubscribed_at, confirmed_at').range(a, b)).then((data) => ({ data })),
    fetchAll((a, b) => db.from('v_subscriber_rfm').select('email, orders, revenue, last_order_at').range(a, b)).then((data) => ({ data })),
    fetchAll((a, b) => db.from('subscribers').select('email').not('suppressed_at', 'is', null).range(a, b)).then((data) => ({ data })),
  ]);
  const byEmail = new Map((rfm || []).map((r: any) => [String(r.email).toLowerCase(), r]));
  const suppressed = new Set((sup || []).map((r: any) => String(r.email).toLowerCase()));
  const now = Date.now();
  // the view yields one row per subscriber row; the same address can exist
  // twice (case variants, re-subscribes), so collapse to one row per email
  const seen = new Map<string, any>();
  for (const r of eng || []) {
    const k = String(r.email).toLowerCase();
    const prev = seen.get(k);
    if (!prev) { seen.set(k, r); continue; }
    seen.set(k, { ...prev, sent: Math.max(prev.sent || 0, r.sent || 0), opened: Math.max(prev.opened || 0, r.opened || 0), clicked: Math.max(prev.clicked || 0, r.clicked || 0),
      bounced: Math.max(prev.bounced || 0, r.bounced || 0), complained: Math.max(prev.complained || 0, r.complained || 0),
      last_opened_at: [prev.last_opened_at, r.last_opened_at].filter(Boolean).sort().pop() || null, last_clicked_at: [prev.last_clicked_at, r.last_clicked_at].filter(Boolean).sort().pop() || null,
      unsubscribed_at: prev.unsubscribed_at || r.unsubscribed_at, confirmed_at: prev.confirmed_at || r.confirmed_at, joined_at: [prev.joined_at, r.joined_at].filter(Boolean).sort()[0] });
  }
  return [...seen.values()].map((r: any) => {
    const email = String(r.email).toLowerCase();
    const f = byEmail.get(email) || {};
    const orders = Number(f.orders) || 0, revenue = Number(f.revenue) || 0, lastOrder = f.last_order_at || null;
    const lo = r.last_opened_at ? new Date(r.last_opened_at).getTime() : 0;
    const lc = r.last_clicked_at ? new Date(r.last_clicked_at).getTime() : 0;
    const lb = lastOrder ? new Date(lastOrder).getTime() : 0;
    let tier: EngRow['tier'];
    if (r.unsubscribed_at || !r.confirmed_at || r.bounced || r.complained || suppressed.has(email)) tier = 'out';
    else if ((lc && now - lc <= 30 * DAY) || (lb && now - lb <= 30 * DAY)) tier = 'hot';
    else if (lo && now - lo <= 30 * DAY) tier = 'warm';
    else if (lo && now - lo <= 180 * DAY) tier = 'cool';
    else if (!lo && (r.sent || 0) < 6) tier = 'new';
    else tier = 'cold';
    return { email, source: r.source, joined_at: r.joined_at, sent: r.sent || 0, opened: r.opened || 0, clicked: r.clicked || 0, bounced: r.bounced || 0, complained: r.complained || 0, last_opened_at: r.last_opened_at, last_clicked_at: r.last_clicked_at, unsubscribed_at: r.unsubscribed_at, orders, revenue, last_order_at: lastOrder, tier };
  });
}

export async function segmentStats(db: DB) {
  const rows = await engagementRows(db);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const blank = () => ({ count: 0, sent: 0, opened: 0, clicked: 0, buyers: 0, revenue: 0, hot: 0, warm: 0, cool: 0, new: 0, cold: 0 });
  const tiers: Record<string, any> = Object.fromEntries(TIERS.map((t) => [t, blank()]));
  const bySource: Record<string, any> = {};
  const byCohort: Record<string, any> = {};
  let out = 0;
  for (const r of rows) {
    if (r.tier === 'out') { out++; continue; }
    const add = (o: any) => { o.count++; o.sent += r.sent; o.opened += r.opened; o.clicked += r.clicked; if (r.orders > 0) o.buyers++; o.revenue += r.revenue; o[r.tier]++; };
    add(tiers[r.tier]);
    add(bySource[r.source || 'unknown'] ||= blank());
    const month = String(r.joined_at || '').slice(0, 7);
    if (month) add(byCohort[month] ||= blank());
  }
  const finish = (o: any) => ({ ...o, openRate: pct(o.opened, o.sent), clickRate: pct(o.clicked, o.sent), revenue: Math.round(o.revenue * 100) / 100, responsive: pct(o.hot + o.warm, o.count) });
  const top = rows.filter((r) => r.tier !== 'out').map((r) => ({
    ...r, score: r.clicked * 3 + r.opened + r.orders * 5 + (r.last_clicked_at && Date.now() - new Date(r.last_clicked_at).getTime() <= 7 * DAY ? 5 : 0),
  })).sort((a, b) => b.score - a.score).slice(0, 60);
  const cohorts = Object.entries(byCohort).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).map(([month, o]) => ({ month, ...finish(o) }));
  return {
    total: rows.length, out,
    tiers: TIERS.map((t) => ({ tier: t, ...finish(tiers[t]) })),
    sources: Object.entries(bySource).map(([source, o]) => ({ source, ...finish(o) })).sort((a, b) => b.count - a.count),
    cohorts, top,
  };
}
