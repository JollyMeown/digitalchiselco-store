// Admin "Send hand-picked designs": the owner selects products + writes a
// personal note; this sends ONE branded email (logo + template shell) to the
// customer who asked. Admin-gated; deduped per exact selection per day.
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail } from '../../../lib/resend';
import { productPicksEmail, type MiniProduct } from '../../../lib/marketing-emails';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;

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

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  const name = String(body.name || '').trim().slice(0, 60) || null;
  const note = String(body.note || '').trim().slice(0, 1000) || null;
  const ids: string[] = (Array.isArray(body.product_ids) ? body.product_ids : [])
    .map((x: any) => String(x)).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 12);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid recipient email.' }, 400);
  if (!ids.length) return json({ error: 'Pick at least one design.' }, 400);

  const db = supabaseAdmin();
  const { data: prods } = await db.from('products')
    .select('title, slug, image_url, price_usd, active').in('id', ids);
  const products = (prods || []).filter((p: any) => p.active) as MiniProduct[];
  if (!products.length) return json({ error: 'None of the selected designs are active.' }, 400);

  // Respect unsubscribes even for personal sends.
  const { data: sub } = await db.from('subscribers').select('unsubscribed_at').ilike('email', email).maybeSingle();
  if (sub?.unsubscribed_at) return json({ error: 'This person has unsubscribed from emails, better to reply to them directly instead.' }, 400);

  const { subject, html, text } = productPicksEmail({ email, products, note, name });
  const key = 'picks:' + createHash('sha256').update(`${email}|${ids.sort().join(',')}|${new Date().toISOString().slice(0, 10)}`).digest('hex').slice(0, 28);
  const r = await sendEmail({ to: email, subject, html, text, idempotencyKey: key, tags: [{ name: 'kind', value: 'picks' }] });
  if (!r.ok) return json({ error: r.error || 'Send failed.' }, 502);
  return json({ ok: true, sent: products.length, skipped: !!r.skipped });
};
