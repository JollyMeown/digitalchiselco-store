// Admin: scan the whole catalogue for products a buyer could pay for and
// receive nothing from (owner 2026-09-10: "There must be a check button on
// website to see any download link missing").
//
// The Overview tile reports this passively once a day. This is the button that
// answers the question on demand, right after a BRS upload run, and it looks at
// the entire catalogue rather than the page the Products tab happens to be
// showing. The database guard (migration 118) stops a fileless product going
// live at all, so most of what this finds should be held drafts waiting for
// their file rather than live listings.
//
// Four faults, in the order they cost money:
//   1. MISSING    sellable, no download row at all. The buyer gets nothing.
//   2. HELD       held off the storefront by the guard, waiting for its file.
//   3. BAD LINK   a download row whose link is empty or not a real URL.
//   4. SHARED     one link attached to several products. Worse than a dead
//                 link when it is wrong, because nothing looks broken until a
//                 customer complains. Two innocent explanations exist though,
//                 so the report separates them rather than crying wolf:
//                 a bundle legitimately carries every file it contains, and
//                 the same design is sometimes listed twice under different
//                 titles. What is left, two DIFFERENT designs pointing at one
//                 file, means one of them ships the wrong model. That is
//                 judged by how much the titles have in common, which is a
//                 signal and not a proof, and the report says so.
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

// Memberships and gift cards are delivered by their own engines and correctly
// have no download row. Same rule as the database trigger and the Overview
// tile, so all three can never disagree.
const isExempt = (p: any) =>
  p.is_subscription || p.membership_plan_slug ||
  /^gift-card/i.test(p.slug || '') || /membership/i.test(p.slug || '');

export const GET: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const db = supabaseAdmin();
    const [products, downloads] = await Promise.all([
      fetchAll((a, b) => db.from('products')
        .select('id, slug, title, active, price_usd, held_missing_file, is_subscription, membership_plan_slug, submitted_by, created_at, is_bundle')
        .order('created_at', { ascending: false }).range(a, b)),
      fetchAll((a, b) => db.from('product_downloads').select('id, product_id, file_name, download_link').order('id').range(a, b)),
    ]);

    const byProduct = new Map<string, any[]>();
    for (const d of downloads as any[]) {
      if (!byProduct.has(d.product_id)) byProduct.set(d.product_id, []);
      byProduct.get(d.product_id)!.push(d);
    }

    const brief = (p: any, extra: Record<string, unknown> = {}) => ({
      id: p.id, slug: p.slug, title: p.title, active: p.active,
      price_usd: Number(p.price_usd) || 0,
      submitted_by: p.submitted_by || null,
      created_at: p.created_at, ...extra,
    });

    const missing: any[] = [], held: any[] = [], badLink: any[] = [];
    let sellable = 0, exempt = 0, withFile = 0;

    for (const p of products as any[]) {
      if (isExempt(p)) { exempt++; continue; }
      const sell = Number(p.price_usd) > 0;
      if (!sell) continue;
      sellable++;
      const dls = byProduct.get(p.id) || [];
      if (!dls.length) {
        // held is the guard doing its job; missing while live is the emergency
        (p.active ? missing : held).push(brief(p, { reason: p.active ? 'live with no file' : 'held as draft, waiting for its file' }));
        continue;
      }
      withFile++;
      for (const d of dls) {
        const url = String(d.download_link || '').trim();
        if (!url || !/^https?:\/\/\S+$/i.test(url)) {
          badLink.push(brief(p, { file_name: d.file_name, download_link: url || '(empty)' }));
        }
      }
    }

    // One link on several products: whoever bought the odd one out is getting
    // somebody else's file, and nothing about it looks broken.
    const byLink = new Map<string, string[]>();
    for (const d of downloads as any[]) {
      const url = String(d.download_link || '').trim();
      if (!url) continue;
      if (!byLink.has(url)) byLink.set(url, []);
      const arr = byLink.get(url)!;
      if (!arr.includes(d.product_id)) arr.push(d.product_id);
    }
    const productById = new Map((products as any[]).map((p) => [p.id, p]));
    // Words every listing carries say nothing about which design it is, so they
    // are dropped before the titles are compared.
    const NOISE = new Set(['stl', 'file', 'files', 'cnc', 'router', 'wood', 'carving', 'relief', 'bas', 'basrelief', 'wall', 'art', 'design', 'designs', 'panel', 'decor', 'model', 'aspire', 'vcarve', 'carveco', 'digital', 'download', 'for', 'and', 'with', 'the', 'a', 'of', 'to', 'gift', 'gifts', 'custom', 'pro', '3d']);
    const words = (t: string) => new Set(String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !NOISE.has(w)));
    /** Jaccard overlap of the meaningful words in two titles. */
    function overlap(a: string, b: string): number {
      const A = words(a), B = words(b);
      if (!A.size || !B.size) return 0;
      let hit = 0; for (const w of A) if (B.has(w)) hit++;
      return hit / Math.min(A.size, B.size);
    }
    const sharedAll = [...byLink.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([url, ids]) => {
        const items = ids.map((id) => {
          const p = productById.get(id);
          return p ? { id, slug: p.slug, title: p.title, active: p.active, is_bundle: !!p.is_bundle } : { id, slug: null, title: '(deleted product)', active: false, is_bundle: false };
        });
        // worst pair decides: if any two titles look unrelated, the group needs a look
        let worst = 1;
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) worst = Math.min(worst, overlap(items[i].title, items[j].title));
        }
        const hasBundle = items.some((p) => p.is_bundle);
        return {
          download_link: url, products: items, similarity: +worst.toFixed(2),
          kind: hasBundle ? 'bundle' : worst >= 0.4 ? 'duplicate-listing' : 'mismatch',
        };
      });
    // Only the mismatches are a fault. The rest is reported as a count so the
    // owner can see the check looked at them and decided they were fine.
    const shared = sharedAll.filter((s) => s.kind === 'mismatch').sort((a, b) => a.similarity - b.similarity).slice(0, 40);
    const sharedBenign = {
      bundle: sharedAll.filter((s) => s.kind === 'bundle').length,
      duplicateListing: sharedAll.filter((s) => s.kind === 'duplicate-listing').length,
    };

    // Which BRS machine uploaded the products that came up short. The upload
    // runs from several computers, so naming the source is what makes the
    // report actionable rather than merely alarming.
    const byComputer: Record<string, number> = {};
    for (const p of [...missing, ...held]) {
      const k = p.submitted_by || 'unknown';
      byComputer[k] = (byComputer[k] || 0) + 1;
    }

    return json({
      ok: true,
      checkedAt: new Date().toISOString(),
      totals: {
        products: (products as any[]).length,
        sellable, exempt, withFile,
        missing: missing.length, held: held.length, badLink: badLink.length,
        sharedLinks: shared.length,
      },
      sharedBenign,
      missing, held, badLink, shared, byComputer,
    });
  } catch (e: any) {
    return json({ error: e?.message || 'check failed' }, 500);
  }
};
