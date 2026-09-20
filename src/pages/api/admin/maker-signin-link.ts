// Admin: hand an approved maker their dashboard sign-in link.
//
// Bruce, the first approved maker, wrote in on 2026-09-20 asking how to reach
// his maker page: the link only ever existed inside emails. Makers can now
// request one themselves at /maker, and the owner can send or copy one from
// the maker's card in Admin.
//
//   POST { id, send?: true }  ->  { ok, link, sent }
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail } from '../../../lib/resend';
import { signMakerToken } from '../../../lib/marketplace-token';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const SITE = (import.meta.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function callerAdmin(request: Request): Promise<boolean> {
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
  if (!(await callerAdmin(request))) return json({ error: 'Admins only.' }, 403);
  const b = await request.json().catch(() => ({} as any));
  const id = String(b.id || '');
  if (!id) return json({ error: 'Missing maker.' }, 400);

  const { data: maker } = await supabaseAdmin().from('makers').select('id, email, maker_name, status').eq('id', id).maybeSingle();
  if (!maker) return json({ error: 'Maker not found.' }, 404);
  if (maker.status !== 'approved') return json({ error: `This maker is ${maker.status}. Approve them first.` }, 400);

  const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(maker.email))}`;
  if (!b.send) return json({ ok: true, link, sent: false });

  try {
    await sendEmail({
      to: maker.email,
      subject: 'Your Cut Local maker sign-in link',
      html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;"><p>Hi ${maker.maker_name || ''},</p><p>Here is your sign-in link to the Cut Local maker dashboard, where you can edit your listing, your photos and your quotes:</p><p style="margin:20px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">Open my dashboard →</a></p><p style="font-size:13px;">You can always get a fresh link yourself at <a href="${SITE}/maker">${SITE.replace(/^https?:\/\//, '')}/maker</a>.</p><p style="font-size:12px;color:#9a8b76;">Valid for 30 days.</p></div>`,
      text: `Your Cut Local maker dashboard: ${link}\n\nYou can always get a fresh link at ${SITE}/maker (valid 30 days).`,
      tags: [{ name: 'kind', value: 'marketplace' }],
    });
  } catch (e: any) {
    return json({ error: e?.message || 'Could not send the email.' }, 500);
  }
  return json({ ok: true, link, sent: true, email: maker.email });
};
