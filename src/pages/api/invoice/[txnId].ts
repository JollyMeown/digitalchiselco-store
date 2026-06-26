// Permanent redirect → Paddle's hosted PDF invoice.
//
// Paddle's invoice URLs (S3 pre-signed) expire after ~1 hour, so we can't
// embed them directly in the order confirmation email. This endpoint fetches
// a fresh URL on every click and 302-redirects to it.
//
// Light auth: only redirects if the txn ID actually exists in our orders
// table. Paddle txn IDs are 30-char random IDs (~150 bits of entropy) so
// they're not practically enumerable, but rejecting unknown ones blocks
// idle probing.

import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { paddleApi } from '../../../lib/paddle';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const txnId = (params.txnId || '').trim();
  if (!txnId || !/^txn_[a-z0-9]+$/i.test(txnId)) {
    return new Response('Invalid transaction id', { status: 400 });
  }

  // Light gate: only allow if this txn exists in our orders table.
  const db = supabaseAdmin();
  const { data: order } = await db
    .from('orders')
    .select('id')
    .eq('paddle_transaction_id', txnId)
    .maybeSingle();
  if (!order) {
    return new Response('Invoice not found', { status: 404 });
  }

  try {
    const res = await paddleApi<{ data: { url: string } }>(`/transactions/${txnId}/invoice`);
    const url = res?.data?.url;
    if (!url) return new Response('Paddle did not return an invoice URL', { status: 502 });
    return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
  } catch (e: any) {
    console.error(`[invoice] Paddle API failed for ${txnId}:`, e.message);
    return new Response('Could not load invoice from Paddle. Please email jolly@digitalchiselco.com for a copy.', { status: 502 });
  }
};
