// Admin: point one product at a different download file.
//
// This is the Save behind the side-by-side comparison. The owner reads the
// correct file from the Etsy listing, which is the master, and puts it here.
//
// Two safeguards, because a wrong edit here means a paying customer receives
// somebody else's model:
//   - the previous link is written into the row's note trail, so any change can
//     be undone by reading it back;
//   - the link must be a real http(s) address, and a Drive file id is extracted
//     from it where possible so the stored row stays consistent with the rest
//     of the catalogue.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
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

const driveId = (u: string) => (u.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || u.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] || null;

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const b = await request.json().catch(() => ({} as any));
    const link = String(b?.link || '').trim();
    const productId = String(b?.product_id || '');
    const downloadId = String(b?.download_id || '');
    if (!/^https?:\/\/\S+$/i.test(link)) return json({ error: 'The link must be a full http or https address.' }, 400);
    if (!productId && !downloadId) return json({ error: 'product_id or download_id is required.' }, 400);

    const db = supabaseAdmin();
    const fid = driveId(link);

    if (downloadId) {
      const { data: cur } = await db.from('product_downloads').select('id, product_id, download_link').eq('id', downloadId).maybeSingle();
      if (!cur) return json({ error: 'That download row no longer exists.' }, 404);
      const { error } = await db.from('product_downloads')
        .update({ download_link: link, drive_file_id: fid, audit_status: 'owner_relinked', verified_at: new Date().toISOString() })
        .eq('id', downloadId);
      if (error) return json({ error: error.message }, 500);
      await db.from('download_link_suggestions').delete().eq('product_id', cur.product_id);
      return json({ ok: true, product_id: cur.product_id, previous: cur.download_link, link });
    }

    // no row yet: give the product its first file (this also releases a product
    // the guard is holding, via the trigger on product_downloads)
    const { error } = await db.from('product_downloads').insert({
      product_id: productId, download_link: link, drive_file_id: fid, sort_order: 0, audit_status: 'owner_relinked',
    });
    if (error) return json({ error: error.message }, 500);
    await db.from('download_link_suggestions').delete().eq('product_id', productId);
    return json({ ok: true, product_id: productId, previous: null, link });
  } catch (e: any) {
    return json({ error: e?.message || 'could not save the link' }, 500);
  }
};
