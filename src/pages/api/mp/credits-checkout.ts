// A maker buys a credit pack. Creates a Paddle transaction (ad-hoc price) +
// a TRUSTED maker_credit_purchases row the webhook grants from. Returns the
// transaction id for Paddle.Checkout.open({ transactionId }).
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { paddleApi } from '../../../lib/paddle';
import { verifyMakerToken } from '../../../lib/marketplace-token';
import { CREDIT_PACKS } from '../../../lib/marketplace';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const b = await request.json().catch(() => ({}));
  const auth = verifyMakerToken(b.token);
  if (!auth) return json({ error: 'Session expired — open your dashboard link again.' }, 401);
  const pack = CREDIT_PACKS[String(b.pack || '')];
  if (!pack) return json({ error: 'Unknown pack.' }, 400);

  const db = supabaseAdmin();
  const { data: m } = await db.from('makers').select('id, email, credits').eq('email', auth.email).eq('status', 'approved').maybeSingle();
  if (!m) return json({ error: 'Your maker account is not active.' }, 403);

  let txn: any;
  try {
    txn = await paddleApi<any>('/transactions', {
      method: 'POST',
      body: {
        items: [{
          quantity: 1,
          price: {
            description: `Cut Local ${pack.label}`,
            name: `Cut Local ${pack.label}`,
            product: { name: `Cut Local ${pack.label}`, tax_category: 'standard' },
            unit_price: { amount: String(Math.round(pack.price * 100)), currency_code: 'USD' },
          },
        }],
        customer: { email: m.email },
        // routing hint only; the webhook grants from the trusted DB row below
        custom_data: { source: 'cut-local-credits', maker_id: m.id, credits: pack.credits, pack: b.pack },
      },
    });
  } catch (e: any) { console.error('[credits-checkout]', e?.message); return json({ error: 'Could not start checkout.' }, 500); }

  if (txn?.data?.id) {
    try {
      await db.from('maker_credit_purchases').insert({ txn_id: txn.data.id, maker_id: m.id, credits: pack.credits, amount_usd: pack.price, pack: String(b.pack), status: 'pending' });
    } catch (e) { console.error('[credits-checkout] snapshot insert failed:', (e as any)?.message); }
  }
  return json({ ok: true, transaction_id: txn?.data?.id });
};
