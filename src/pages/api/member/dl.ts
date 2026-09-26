// A Diamond Select download: /api/member/dl?e=<entitlement id>&f=<file index>
//
// The account page's Download buttons for designs picked with credits come
// here instead of going straight to Google Drive, so each download is counted
// (member_downloads: who, which design, when, which country) for the admin
// view and its sharing warning. Then it opens exactly the same file.
// Only the member who owns the entitlement can use the link (signed account
// cookie); a shared link opens the sign-in page for anyone else.
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyAccountToken } from '../../../lib/account-token';
import { clientIp } from '../../../lib/rate-limit';

export const prerender = false;
const UUID = /^[0-9a-f-]{36}$/i;

function country(req: Request): string | null {
  const h = req.headers.get('x-country') || req.headers.get('x-nf-country') || '';
  if (/^[A-Z]{2}$/.test(h)) return h;
  try {
    const geo = req.headers.get('x-nf-geo');
    if (geo) { const g = JSON.parse(Buffer.from(geo, 'base64').toString('utf8')); if (g?.country?.code) return String(g.country.code).slice(0, 2); }
  } catch { /* no geo */ }
  return null;
}

export const GET: APIRoute = async ({ request, url, cookies, redirect }) => {
  const sess = verifyAccountToken(cookies.get('dcc_account')?.value);
  if (!sess?.email) return redirect('/account#diamond', 302);
  const eid = url.searchParams.get('e') || '';
  const f = Math.max(0, Math.min(20, parseInt(url.searchParams.get('f') || '0', 10) || 0));
  if (!UUID.test(eid)) return new Response('Unknown download.', { status: 400 });

  const db = supabaseAdmin();
  const { data: ent } = await db.from('entitlements').select('id, email, product_id').eq('id', eid).maybeSingle();
  if (!ent || String(ent.email).toLowerCase() !== sess.email.toLowerCase()) return new Response('This download belongs to another account.', { status: 403 });
  const { data: files } = await db.from('product_downloads').select('download_link').eq('product_id', ent.product_id).order('file_name').order('download_link');
  const link = (files || [])[f]?.download_link || (files || [])[0]?.download_link;
  if (!link) return new Response('The file for this design is being prepared. Please try again later or reply to any of our emails.', { status: 404 });

  try {
    const secret = process.env.ACCOUNT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dl';
    await db.from('member_downloads').insert({
      email: sess.email.toLowerCase(), product_id: ent.product_id, entitlement_id: ent.id, file_index: f,
      country: country(request),
      ip_hash: crypto.createHash('sha256').update(`${clientIp(request)}|${secret}`).digest('hex').slice(0, 24),
      user_agent: (request.headers.get('user-agent') || '').slice(0, 200),
    });
    await db.from('entitlements').update({ download_count: ((await db.from('entitlements').select('download_count').eq('id', ent.id).maybeSingle()).data?.download_count || 0) + 1 }).eq('id', ent.id);
  } catch (e) { console.error('member download log failed:', e); }   // never block the download

  return redirect(link, 302);
};
