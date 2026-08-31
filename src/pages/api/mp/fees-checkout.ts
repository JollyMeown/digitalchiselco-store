// A maker pays their pending success-fee invoice. Same trusted-snapshot flow
// as credit packs: the Paddle txn carries only a routing hint; the webhook
// settles from the maker_fee_invoices row keyed by txn id.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { paddleApi } from '../../../lib/paddle';
import { verifyMakerToken } from '../../../lib/marketplace-token';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const b = await request.json().catch(() => ({}));
  const auth = verifyMakerToken(b.token);
  if (!auth) return json({ error: 'Session expired. Open your dashboard link again.' }, 401);

  const db = supabaseAdmin();
  const { data: m } = await db.from('makers').select('id, email').eq('email', auth.email).eq('status', 'approved').maybeSingle();
  if (!m) return json({ error: 'Your maker account is not active.' }, 403);
  const { data: invs } = await db.from('maker_fee_invoices').select('*').eq('maker_id', m.id).eq('status', 'pending').order('created_at').limit(1);
  const inv = invs?.[0];
  if (!inv) return json({ error: 'No fees due. You are all settled.' }, 400);

  let txn: any;
  try {
    txn = await paddleApi<any>('/transactions', {
      method: 'POST',
      body: {
        items: [{
          quantity: 1,
          price: {
            description: 'Cut Local success fees',
            name: 'Cut Local success fees',
            product: { name: 'Cut Local success fees', tax_category: 'standard' },
            unit_price: { amount: String(Math.round(Number(inv.amount_usd) * 100)), currency_code: 'USD' },
          },
        }],
        customer: { email: m.email },
        // routing hint only; the webhook settles from the trusted invoice row
        custom_data: { source: 'cut-local-fees', invoice_id: inv.id },
      },
    });
  } catch (e: any) { console.error('[fees-checkout]', e?.message); return json({ error: 'Could not start checkout.' }, 500); }

  if (txn?.data?.id) await db.from('maker_fee_invoices').update({ txn_id: txn.data.id }).eq('id', inv.id);
  return json({ ok: true, transaction_id: txn?.data?.id, amount: inv.amount_usd });
};
