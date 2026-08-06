// Public: upvote a design request. Deduped by a per-visitor hash (one vote per
// request per visitor). POST { id }.
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';

export const prerender = false;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`dvote:${clientIp(request)}`, 60, 3600))) return tooMany('Too many votes — slow down a moment.');
    const b = await request.json().catch(() => ({}));
    const id = String(b.id || '');
    if (!UUID.test(id)) return json({ error: 'bad id' }, 400);
    const db = supabaseAdmin();
    const voter = crypto.createHash('sha256').update(`${clientIp(request)}|${request.headers.get('user-agent') || ''}|dreq`).digest('hex').slice(0, 32);
    // claim the (request, voter) row — unique PK means a repeat is a no-op
    const { error } = await db.from('design_request_votes').insert({ request_id: id, voter });
    if (error) {
      if ((error as any).code === '23505' || /duplicate/i.test(error.message)) return json({ ok: true, already: true });
      return json({ error: 'vote failed' }, 500);
    }
    await db.rpc('increment_design_votes', { p_id: id });
    return json({ ok: true });
  } catch (e: any) {
    console.error('design vote failed:', e);
    return json({ error: 'vote failed' }, 500);
  }
};
