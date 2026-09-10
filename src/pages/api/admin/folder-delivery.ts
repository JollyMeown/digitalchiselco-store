// Admin: turn a shared Google Drive folder into one link a customer can use.
//
// POST { folder_url, title?, code?, note? }  -> creates or updates a delivery
// GET                                        -> lists what exists
//
// The folder is read with the Drive API key, so it must be shared as "anyone
// with the link", which it has to be anyway for the customer to open it. Only
// the file list is stored; the files stay on Drive and are never copied here.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const GOOGLE_KEY = import.meta.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
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

const folderIdOf = (u: string) =>
  (u.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || u.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || (/^[A-Za-z0-9_-]{10,}$/.test(u.trim()) ? [null, u.trim()] : []))[1] || null;

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export const GET: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const { data } = await supabaseAdmin().from('folder_deliveries').select('*').order('created_at', { ascending: false }).limit(50);
  return json({ ok: true, deliveries: (data || []).map((d: any) => ({ ...d, url: `${SITE}/files/${d.code}` })) });
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  if (!GOOGLE_KEY) return json({ error: 'GOOGLE_API_KEY is not set on the server.' }, 500);
  try {
    const b = await request.json().catch(() => ({} as any));
    const folderId = folderIdOf(String(b?.folder_url || ''));
    if (!folderId) return json({ error: 'Paste the Drive folder link (the one containing /folders/).' }, 400);

    // folder name, and a check that it is readable without signing in
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=name,mimeType,capabilities(canDownload)&key=${GOOGLE_KEY}`);
    if (!metaRes.ok) return json({ error: 'Drive would not open that folder. Is it shared as "anyone with the link"?' }, 400);
    const meta = await metaRes.json();
    if (meta.mimeType !== 'application/vnd.google-apps.folder') return json({ error: 'That link is a file, not a folder.' }, 400);

    // every file inside, newest page first, following pagination
    const files: any[] = [];
    let pageToken = '';
    for (let i = 0; i < 20; i++) {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const u = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,size,mimeType)&pageSize=200&orderBy=name_natural&key=${GOOGLE_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const r = await fetch(u);
      if (!r.ok) return json({ error: `Drive listing failed (${r.status}).` }, 502);
      const j = await r.json();
      for (const f of j.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') continue;   // one level only
        files.push({ id: f.id, name: f.name, size: Number(f.size) || null });
      }
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    if (!files.length) return json({ error: 'That folder has no files in it.' }, 400);

    const title = String(b?.title || meta.name || 'Your files').slice(0, 120);
    const code = slugify(String(b?.code || title)) || folderId.slice(0, 12).toLowerCase();
    const db = supabaseAdmin();
    const row = {
      code, title, folder_id: folderId, files,
      note: String(b?.note || '').slice(0, 500) || null, active: true,
    };
    const { error } = await db.from('folder_deliveries').upsert(row, { onConflict: 'code' });
    if (error) return json({ error: error.message }, 500);
    const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0);
    return json({ ok: true, url: `${SITE}/files/${code}`, code, title, files: files.length, totalBytes });
  } catch (e: any) {
    return json({ error: e?.message || 'could not build the delivery' }, 500);
  }
};
