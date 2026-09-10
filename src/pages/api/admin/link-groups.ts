// Everything needed to settle a shared download file by looking at it: the
// products side by side with their pictures, their Etsy listings, the file each
// one currently points at, and any proposal waiting for approval.
//
// The owner's words on 2026-09-10: "ETSY is my Master File where everything is
// fine". So every product carries a link straight into its Etsy listing editor,
// where the correct file can be read off the master and pasted back here. The
// Drive proposal is a convenience on top of that, never a replacement for it,
// and nothing is changed until the owner presses Save.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { fetchAll } from '../../../lib/fetch-all';

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

const NOISE = new Set(['stl', 'file', 'files', 'cnc', 'router', 'wood', 'carving', 'relief', 'bas', 'wall', 'art', 'design', 'designs', 'panel', 'decor', 'model', 'aspire', 'vcarve', 'carveco', 'digital', 'download', 'for', 'and', 'with', 'the', 'gift', 'gifts', 'custom', 'pro', '3d']);
const words = (t: string) => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !NOISE.has(w)));
function overlap(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const db = supabaseAdmin();
    const [products, downloads, { data: suggestions }] = await Promise.all([
      fetchAll((a, b) => db.from('products')
        .select('id, slug, title, image_url, active, price_usd, is_bundle, etsy_listing_id, etsy_sales_365, submitted_by')
        .order('id').range(a, b)),
      fetchAll((a, b) => db.from('product_downloads').select('id, product_id, file_name, download_link, sort_order').order('id').range(a, b)),
      db.from('download_link_suggestions').select('*'),
    ]);

    const byId = new Map((products as any[]).map((p) => [p.id, p]));
    const dlByProduct = new Map<string, any[]>();
    for (const d of downloads as any[]) {
      if (!dlByProduct.has(d.product_id)) dlByProduct.set(d.product_id, []);
      dlByProduct.get(d.product_id)!.push(d);
    }
    const sugByProduct = new Map((suggestions || []).map((s: any) => [s.product_id, s]));

    const byLink = new Map<string, Set<string>>();
    for (const d of downloads as any[]) {
      const u = String(d.download_link || '').trim();
      if (!u) continue;
      if (!byLink.has(u)) byLink.set(u, new Set());
      byLink.get(u)!.add(d.product_id);
    }

    const groups = [...byLink.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([url, ids]) => {
        const items = [...ids].map((id) => byId.get(id)).filter(Boolean) as any[];
        const hasBundle = items.some((p) => p.is_bundle);
        let worst = 1;
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) worst = Math.min(worst, overlap(items[i].title, items[j].title));
        return {
          download_link: url,
          similarity: +worst.toFixed(2),
          kind: hasBundle ? 'bundle' : worst >= 0.4 ? 'duplicate-listing' : 'mismatch',
          products: items.map((p) => ({
            id: p.id, slug: p.slug, title: p.title, image_url: p.image_url,
            active: p.active, price_usd: Number(p.price_usd) || 0,
            etsy_listing_id: p.etsy_listing_id ? String(p.etsy_listing_id) : null,
            etsy_sales_365: p.etsy_sales_365 ?? null,
            submitted_by: p.submitted_by || null,
            downloads: (dlByProduct.get(p.id) || []).map((d) => ({ id: d.id, file_name: d.file_name, download_link: d.download_link })),
            suggestion: sugByProduct.get(p.id) || null,
          })),
        };
      })
      .filter((g) => g.kind === 'mismatch')
      .sort((a, b) => a.similarity - b.similarity);

    return json({ ok: true, groups, suggestions: (suggestions || []).length, fetchedAt: new Date().toISOString() });
  } catch (e: any) {
    return json({ error: e?.message || 'could not build the comparison' }, 500);
  }
};
