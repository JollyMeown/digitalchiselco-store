// Returns the signed-in maker's id (from their token) so the dashboard can
// address chat threads. No PII beyond the id.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyMakerToken } from '../../../lib/marketplace-token';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = async ({ url }) => {
  const auth = verifyMakerToken(url.searchParams.get('t'));
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const { data } = await supabaseAdmin().from('makers').select('id').eq('email', auth.email).maybeSingle();
  return json({ ok: true, maker_id: data?.id || null });
};
