// Diamond Select credits, for the product page (lib/diamond-select.ts).
//   GET  ?product=<uuid>  -> { offered, signedIn, active, left, earned, total, nextDate, lastDay, inGrace, covered, owned, discount }
//   POST { product_id }   -> uses 1 credit: the design is added to the member's account
// Identity is the signed account cookie (the same one /account sets), so only
// the member can use their credits. Product pages are cached at the edge,
// which is why the page asks here from the browser instead of rendering it.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyAccountToken } from '../../../lib/account-token';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';
import { diamondOffered, activeDiamond, creditsFor, passCovers, DIAMOND_SLUG, DIAMOND_EXTRA_DISCOUNT, DIAMOND_CREDITS_PER_MONTH } from '../../../lib/diamond-select';

export const prerender = false;

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
});
const UUID = /^[0-9a-f-]{36}$/i;
const PRODUCT_SEL = 'id, slug, active, is_bundle, membership_plan_slug, is_customizable, price_usd';

export const GET: APIRoute = async ({ url, cookies }) => {
  const db = supabaseAdmin();
  const offered = await diamondOffered(db).catch(() => false);
  const sess = verifyAccountToken(cookies.get('dcc_account')?.value);
  if (!sess?.email) return json({ offered, signedIn: false, active: false });
  const term = await activeDiamond(db, sess.email);
  if (!term) return json({ offered, signedIn: true, active: false });
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
  const c = await creditsFor(db, term, sess.email);
  return json({ offered, signedIn: true, active: true, ...c, inGrace: term.inGrace, covered, owned, discount: DIAMOND_EXTRA_DISCOUNT });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const sess = verifyAccountToken(cookies.get('dcc_account')?.value);
  if (!sess?.email) return json({ error: 'Please sign in to your account first.' }, 401);
  if (!(await rateLimit(`pass:${clientIp(request)}`, 40, 600))) return tooMany('Too many requests. Please wait a minute.');
  const body = await request.json().catch(() => ({}));
  const pid = String(body.product_id || '');
  if (!UUID.test(pid)) return json({ error: 'Unknown design.' }, 400);

  const db = supabaseAdmin();
  const term = await activeDiamond(db, sess.email);
  if (!term) return json({ error: 'Your account has no active Diamond Select membership.' }, 403);
  const { data: p } = await db.from('products').select(PRODUCT_SEL).eq('id', pid).maybeSingle();
  if (!passCovers(p as any)) return json({ error: 'Credits are for single designs. Bundles, sets and made-to-order items are not included.' }, 400);

  const { count: have } = await db.from('entitlements').select('id', { count: 'exact', head: true }).ilike('email', sess.email).eq('product_id', pid);
  if ((have || 0) > 0) return json({ ok: true, already: true, url: '/account#diamond' });

  const c = await creditsFor(db, term, sess.email);
  if (c.left < 1) {
    return json({ error: c.nextDate ? `No credits left. Your next ${DIAMOND_CREDITS_PER_MONTH} arrive on ${c.nextDate}.` : 'You have used all the credits of this membership.' }, 429);
  }
  const { error } = await db.from('entitlements').insert({ email: sess.email.toLowerCase(), product_id: pid, source: DIAMOND_SLUG, order_id: null });
  if (error) { console.error('diamond credit failed:', error); return json({ error: 'Could not add the design. Please try again.' }, 500); }
  return json({ ok: true, left: c.left - 1, url: '/account#diamond' });
};
