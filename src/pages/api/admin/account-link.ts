// Admin: mint a sign-in link for a customer's /account dashboard.
//
// Normally the customer requests this themselves and it arrives by email. That
// route is closed for exactly the buyer who needs it most: someone whose mail
// provider rejects us cannot receive a magic link either, so "check your
// account page" is useless advice to them. This endpoint hands the owner a
// working link to paste into a reply on Etsy, a support ticket, or wherever
// the customer actually reached them.
//
// The token is signed HERE, on the server, so it carries the deployment's own
// ACCOUNT_TOKEN_SECRET. A link signed anywhere else would be rejected.
//
// Worst case if the link leaks: someone can re-download files that email
// address has already paid for. No payment details are exposed. It expires.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { signAccountToken } from '../../../lib/account-token';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const SITE = import.meta.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

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
  try {
    const body = await request.json().catch(() => ({} as any));
    const email = String(body?.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid customer email is required.' }, 400);
    // Only ever for a real customer: an address with no paid order has nothing
    // to see, and minting links for arbitrary addresses would be a way to
    // fish for other people's purchases.
    const db = supabaseAdmin();
    const { data: orders } = await db.from('orders').select('id').eq('email', email).eq('status', 'paid').limit(1);
    if (!orders?.length) return json({ error: 'No paid order exists for that address.' }, 404);

    // 30 days: long enough to survive a slow support conversation, short
    // enough that a link pasted into a message does not live forever.
    const days = Math.min(90, Math.max(1, Number(body?.days) || 30));
    const token = signAccountToken(email, days * 24 * 60 * 60);
    return json({ ok: true, url: `${SITE}/account?token=${encodeURIComponent(token)}`, email, expiresInDays: days });
  } catch (e: any) {
    return json({ error: e?.message || 'could not create the link' }, 500);
  }
};
