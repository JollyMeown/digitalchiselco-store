// "Email me this pack again", from the member portal. Identity comes from the
// dcc_account cookie (the same signed token the portal itself trusts), so a
// member can only ask for packs on their own membership.
import type { APIRoute } from 'astro';
import { verifyAccountToken } from '../../../lib/account-token';
import { resendPack } from '../../../lib/subscriptions';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = verifyAccountToken(cookies.get('dcc_account')?.value);
  if (!session?.email) return json({ error: 'Please sign in to your account first.' }, 401);
  const b = await request.json().catch(() => ({} as any));
  const subId = String(b?.subscription || '').trim();
  const month = String(b?.month || '').trim();
  if (!subId || !/^\d{4}-\d{2}$/.test(month)) return json({ error: 'bad request' }, 400);
  const r = await resendPack(subId, month, { requireEmail: session.email });
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
};
