// Poll chat messages for one (request, maker) thread. Auth by token: a buyer
// (request token) sees any of their threads; a maker sees only their own.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyMakerToken, verifyRequestToken } from '../../../lib/marketplace-token';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('t');
  const request_id = url.searchParams.get('request_id') || '';
  const maker_id = url.searchParams.get('maker_id') || '';
  const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
  const db = supabaseAdmin();
  const maker = verifyMakerToken(token);
  const buyer = verifyRequestToken(token);
  if (!maker && !buyer) return json({ error: 'unauthorized' }, 401);

  if (buyer && buyer.id !== request_id) return json({ error: 'forbidden' }, 403);
  if (maker) {
    const { data: m } = await db.from('makers').select('id').eq('email', maker.email).maybeSingle();
    if (!m || m.id !== maker_id) return json({ error: 'forbidden' }, 403);
  }
  let q = db.from('maker_messages').select('id, sender, body, attachments, created_at').eq('request_id', request_id).order('id').limit(500);
  if (maker_id) q = q.eq('maker_id', maker_id);
  if (since) q = q.gt('id', since);
  const { data } = await q;
  return json({ ok: true, messages: data || [] });
};
