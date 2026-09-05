// Admin: manually add a paid member (e.g. an Etsy buyer) and send their first
// pack email immediately. Mirrors the standalone app's "Add Customer" screen.
// Admin-gated via the caller's Supabase session (profiles.is_admin).

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../../lib/supabase';
import { createSubscriptionForPurchase } from '../../../../lib/subscriptions';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

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
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  const name = body.name ? String(body.name).trim() : null;
  const planSlug = String(body.plan_slug || '').trim();
  const startDate = body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date) ? body.start_date : undefined;
  const source = String(body.source || 'etsy').trim();
  const priceOverride = body.price != null && body.price !== '' ? Number(body.price) : null;
  const couponCode = body.coupon_code ? String(body.coupon_code).trim().toUpperCase() : null;
  const notes = body.notes ? String(body.notes).trim() : null;
  // migration from the old system: packs already received there are not re-sent
  const packsReceived = Math.max(0, Math.min(60, Number(body.packs_received) || 0));

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Valid email required.' }, 400);
  if (!planSlug) return json({ error: 'Plan is required.' }, 400);

  const db = supabaseAdmin();
  const { data: plan } = await db.from('membership_plans').select('slug, name, months, files_per_month, price_usd').eq('slug', planSlug).maybeSingle();
  if (!plan) return json({ error: `Unknown plan "${planSlug}".` }, 400);

  try {
    const r = await createSubscriptionForPurchase({
      email, customerName: name,
      plan: { slug: plan.slug, name: plan.name, months: plan.months, files_per_month: plan.files_per_month, price_usd: priceOverride != null && !Number.isNaN(priceOverride) ? priceOverride : plan.price_usd },
      startDate, source, notes, couponCode, dropsAlreadySent: packsReceived,
    });
    return json({ ok: true, created: r.created, subscriptionId: r.subscriptionId, reason: r.reason, chainedFrom: r.chainedFrom, upgradedFrom: r.upgradedFrom });
  } catch (e: any) {
    console.error('[admin/membership/add] failed:', e);
    return json({ error: e?.message || 'Failed to add member.' }, 500);
  }
};
