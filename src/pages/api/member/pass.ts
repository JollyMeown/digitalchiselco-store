// All-Access pass, for the product page.
//   GET  ?product=<uuid>  -> { offered, signedIn, active, used, limit, endDate, covered, owned }
//   POST { product_id }   -> adds the design to the holder's account
// Identity is the signed account cookie (the same one /account sets), so only
// the holder can use their pass. Product pages are cached at the edge, which
// is why the page asks here from the browser instead of rendering it.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyAccountToken } from '../../../lib/account-token';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';
import { passOffered, activePass, usedLast30, passCovers, PASS_FAIR_USE_PER_30D } from '../../../lib/all-access';

export const prerender = false;

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
});
const UUID = /^[0-9a-f-]{36}$/i;
const PRODUCT_SEL = 'id, slug, active, is_bundle, membership_plan_slug, is_customizable, price_usd';

export const GET: APIRoute = async ({ url, cookies }) => {
  const db = supabaseAdmin();
  const offered = await passOffered(db).catch(() => false);
  const sess = verifyAccountToken(cookies.get('dcc_account')?.value);
  if (!sess?.email) return json({ offered, signedIn: false, active: false });
  const pass = await activePass(db, sess.email);
  if (!pass) return json({ offered, signedIn: true, active: false });
  const pid = url.searchParams.get('product') || '';
  let covered = false, owned = false;
  if (UUID.test(pid)) {
    const [{ data: p }, { count }] = await Promise.all([
      db.from('products').select(PRODUCT_SEL).eq('id', pid).maybeSingle(),
      db.from('entitlements').select('id', { count: 'exact', head: true }).ilike('email', sess.email).eq('product_id', pid),
    ]);
    covered = passCovers(p as any);
    owned = (count || 0) > 0;
  }
  return json({ offered, signedIn: true, active: true, endDate: pass.end_date, used: await usedLast30(db, sess.email), limit: PASS_FAIR_USE_PER_30D, covered, owned });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const sess = verifyAccountToken(cookies.get('dcc_account')?.value);
  if (!sess?.email) return json({ error: 'Please sign in to your account first.' }, 401);
  if (!(await rateLimit(`pass:${clientIp(request)}`, 40, 600))) return tooMany('Too many requests. Please wait a minute.');
  const body = await request.json().catch(() => ({}));
  const pid = String(body.product_id || '');
  if (!UUID.test(pid)) return json({ error: 'Unknown design.' }, 400);

  const db = supabaseAdmin();
  const pass = await activePass(db, sess.email);
  if (!pass) return json({ error: 'Your account has no active All-Access pass.' }, 403);
  const { data: p } = await db.from('products').select(PRODUCT_SEL).eq('id', pid).maybeSingle();
  if (!passCovers(p as any)) return json({ error: 'This item is not included in the pass.' }, 400);

  const { count: have } = await db.from('entitlements').select('id', { count: 'exact', head: true }).ilike('email', sess.email).eq('product_id', pid);
  if ((have || 0) > 0) return json({ ok: true, already: true, url: '/account#pass' });

  const used = await usedLast30(db, sess.email);
  if (used >= PASS_FAIR_USE_PER_30D) {
    return json({ error: `You have added ${used} designs in the last 30 days, the fair-use limit of the pass. More become available as older ones pass 30 days.` }, 429);
  }
  const { error } = await db.from('entitlements').insert({ email: sess.email.toLowerCase(), product_id: pid, source: 'all-access', order_id: null });
  if (error) { console.error('pass claim failed:', error); return json({ error: 'Could not add the design. Please try again.' }, 500); }
  return json({ ok: true, used: used + 1, limit: PASS_FAIR_USE_PER_30D, url: '/account#pass' });
};
