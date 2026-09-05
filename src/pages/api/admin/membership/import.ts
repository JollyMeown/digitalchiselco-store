// Bulk import of members from the old standalone system. Body:
//   { rows: [{ email, name?, plan_slug, start_date, packs_received?, notes? }], dry?: boolean }
// Each row becomes a term starting on start_date with packs_received already
// counted, so nothing the old system sent is sent again; months since then
// that the member has NOT had are delivered now (catch-up). A row whose email
// already has a term starting within 3 days of start_date is skipped.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../../lib/supabase';
import { createSubscriptionForPurchase, daysUntil } from '../../../../lib/subscriptions';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

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

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const b = await request.json().catch(() => ({} as any));
  const rows: any[] = Array.isArray(b?.rows) ? b.rows.slice(0, 500) : [];
  const dry = !!b?.dry;
  if (!rows.length) return json({ error: 'no rows' }, 400);
  const db = supabaseAdmin();
  const { data: plans } = await db.from('membership_plans').select('slug, name, months, files_per_month, price_usd');
  const planBy = new Map((plans || []).map((p: any) => [p.slug, p]));
  const out: { email: string; result: string }[] = [];
  let created = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    const email = String(r.email || '').toLowerCase().trim();
    const plan: any = planBy.get(String(r.plan_slug || '').trim()) || (r.months ? (plans || []).find((p: any) => Number(p.months) === Number(r.months)) : null);
    const start = String(r.start_date || '').slice(0, 10);
    const packs = Math.max(0, Math.min(60, Number(r.packs_received) || 0));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { out.push({ email, result: 'invalid email' }); failed++; continue; }
    if (!plan) { out.push({ email, result: `unknown plan "${r.plan_slug || r.months}"` }); failed++; continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { out.push({ email, result: 'start_date must be YYYY-MM-DD' }); failed++; continue; }
    const { data: existing } = await db.from('member_subscriptions').select('start_date').ilike('email', email);
    if ((existing || []).some((s: any) => Math.abs(daysUntil(start, s.start_date)) <= 3)) { out.push({ email, result: 'already has a term starting then' }); skipped++; continue; }
    if (dry) { out.push({ email, result: `would create ${plan.slug} from ${start}, ${packs} pack(s) already received` }); created++; continue; }
    try {
      const res = await createSubscriptionForPurchase({
        email, customerName: r.name ? String(r.name).trim() : null,
        plan: { slug: plan.slug, name: plan.name, months: plan.months, files_per_month: plan.files_per_month, price_usd: r.price != null && r.price !== '' ? Number(r.price) : plan.price_usd },
        startDate: start, source: 'import', dropsAlreadySent: packs,
        notes: [`imported from the old system`, r.notes ? String(r.notes).trim() : null].filter(Boolean).join(' · '),
      });
      if (res.created) { created++; out.push({ email, result: `created (${plan.slug} from ${start}, ${packs} already received)` }); }
      else { skipped++; out.push({ email, result: res.reason || 'skipped' }); }
    } catch (e: any) { failed++; out.push({ email, result: String(e?.message || e).slice(0, 160) }); }
  }
  return json({ ok: true, dry, created, skipped, failed, rows: out });
};
