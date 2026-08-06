// Redeem loyalty points → a single-use store-credit coupon (CREDIT-XXXX).
// Authenticated by the customer's `dcc_account` cookie (HttpOnly, verified via
// the same HMAC token as /account) — never trusts a browser-supplied email.
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyAccountToken } from '../../../lib/account-token';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';

export const prerender = false;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const session = verifyAccountToken(cookies.get('dcc_account')?.value);
    if (!session?.email) return json({ error: 'Please sign in to redeem points.' }, 401);
    const email = session.email;
    if (!(await rateLimit(`loyalty:${clientIp(request)}`, 10, 3600))) return tooMany('Too many redemptions — try again later.');

    const body = await request.json().catch(() => ({}));
    const dollars = Math.floor(Number(body.dollars) || 0);
    if (dollars < 1) return json({ error: 'Choose at least $1 of credit.' }, 400);

    const db = supabaseAdmin();
    const { data: st } = await db.from('site_settings').select('loyalty_enabled, loyalty_redeem_per_dollar').eq('id', 1).maybeSingle();
    if (!st?.loyalty_enabled) return json({ error: 'Loyalty redemption is not available right now.' }, 400);
    const perDollar = Math.max(1, Number(st.loyalty_redeem_per_dollar) || 100);
    const pointsNeeded = dollars * perDollar;

    // balance = sum of the ledger for this email
    const { data: ledger } = await db.from('loyalty_ledger').select('points').eq('email', email);
    const balance = (ledger || []).reduce((s, r: any) => s + Number(r.points || 0), 0);
    if (balance < pointsNeeded) return json({ error: `Not enough points — you have ${balance}, need ${pointsNeeded}.` }, 400);

    const code = 'CREDIT-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const { error: ce } = await db.from('coupons').insert({
      code, fixed_amount_off: dollars, active: true, max_redemptions: 1,
      description: `store credit for ${email}`,
    });
    if (ce) { console.error('loyalty coupon insert failed:', ce.message); return json({ error: 'Could not create your credit code.' }, 500); }
    // deduct points (append-only ledger)
    await db.from('loyalty_ledger').insert({ email, points: -pointsNeeded, reason: 'redeemed', coupon_code: code });

    return json({ ok: true, code, dollars, points_spent: pointsNeeded, balance: balance - pointsNeeded });
  } catch (e: any) {
    console.error('loyalty redeem failed:', e);
    return json({ error: 'Redemption failed.' }, 500);
  }
};
