import type { APIRoute } from 'astro';
import { validateCoupon, getActiveShopSale } from '../../../lib/discounts';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const code: string = String(body.code || '').trim();
    const email: string | null = body.email ? String(body.email).toLowerCase() : null;
    const cart = Array.isArray(body.items) ? body.items : [];
    if (!code) return json({ ok: false, error: 'Enter a code.' }, 400);
    const result = await validateCoupon(code, cart, email);
    if (!result.ok) return json(result, 400);
    return json(result);
  } catch (e: any) {
    console.error('coupon validate failed:', e);
    return json({ ok: false, error: 'Validation failed.' }, 500);
  }
};

// GET — returns the currently active shop-wide sale (if any), so the cart can
// show the running discount even without a code entered.
export const GET: APIRoute = async () => {
  const sale = await getActiveShopSale();
  return json({ sale });
};
