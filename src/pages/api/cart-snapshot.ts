// A browser reports what its cart holds (migration 139). Called from
// Header.astro on page views with a non-empty cart and whenever the cart
// changes; the cart page adds `converted` just before it empties the cart
// after a successful payment. Titles and prices are read from the database,
// never taken from the browser.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp } from '../../lib/rate-limit';

export const prerender = false;
const ok = () => new Response(null, { status: 204 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deviceOf(ua: string): string {
  if (/bot|crawl|spider|headless|lighthouse|preview/i.test(ua)) return 'bot';
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const originHost = (() => { try { return new URL(request.headers.get('origin') || request.headers.get('referer') || '').hostname; } catch { return ''; } })();
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(originHost)) return ok();   // dev traffic shares the live database
    const ua = request.headers.get('user-agent') || '';
    const device = deviceOf(ua);
    if (device === 'bot') return ok();
    if (!(await rateLimit(`cartsnap:${clientIp(request)}`, 90, 300))) return ok();

    const b = await request.json().catch(() => ({} as any));
    const bid = String(b.bid || '');
    if (!/^[a-z0-9]{16,40}$/.test(bid)) return ok();
    const rawIds: string[] = (Array.isArray(b.ids) ? b.ids : []).map((x: unknown) => String(x)).slice(0, 50);
    const em = typeof b.em === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.em.trim()) ? b.em.trim().toLowerCase().slice(0, 200) : null;
    const path = String(b.p || '').slice(0, 200) || null;
    const now = new Date().toISOString();
    const db = supabaseAdmin();

    // Describe the cart from the database.
    const productIds = rawIds.filter((x) => UUID.test(x));
    const planSlugs = rawIds.filter((x) => x.startsWith('membership:')).map((x) => x.slice(11)).filter((s) => /^[a-z0-9-]{1,40}$/.test(s));
    const items: any[] = [];
    if (productIds.length) {
      const { data } = await db.from('products').select('id, title, slug, price_usd, image_url').in('id', productIds);
      const byId = new Map((data || []).map((p: any) => [String(p.id), p]));
      for (const id of productIds) {
        const p: any = byId.get(id);
        if (p) items.push({ id, title: String(p.title || '').split('|')[0].trim(), price: Number(p.price_usd) || 0, slug: p.slug, image_url: p.image_url });
      }
    }
    if (planSlugs.length) {
      const { data } = await db.from('membership_plans').select('slug, name, price_usd').in('slug', planSlugs);
      for (const pl of data || []) items.push({ id: 'membership:' + pl.slug, title: pl.name, price: Number(pl.price_usd) || 0, slug: null, image_url: null });
    }
    if (rawIds.some((x) => x.startsWith('bundle5:'))) items.push({ id: 'bundle5', title: 'Pick-5 bundle', price: 25, slug: null, image_url: null });
    const total = +items.reduce((n, i) => n + i.price, 0).toFixed(2);
    const sig = items.map((i) => i.id).sort().join(',');

    const { data: prev } = await db.from('cart_snapshots').select('*').eq('browser_id', bid).maybeSingle();
    const prevSig = prev ? (Array.isArray(prev.items) ? prev.items : []).map((i: any) => i.id).sort().join(',') : '';

    if (!items.length) {
      // Cart emptied: keep what it held, so the owner sees what was bought or dropped.
      if (prev && prev.status === 'open') {
        await db.from('cart_snapshots').update({
          status: b.converted ? 'converted' : 'emptied',
          converted_txn: b.converted ? String(b.txn || '').slice(0, 80) || null : null,
          updated_at: now, last_seen_at: now, ...(em ? { email: em } : {}),
        }).eq('browser_id', bid);
      }
      return ok();
    }

    const country = (request.headers.get('x-country') || '').toUpperCase().slice(0, 2) || null;
    if (!prev || prev.status !== 'open') {
      await db.from('cart_snapshots').upsert({
        browser_id: bid, items, item_count: items.length, total_usd: total, email: em || prev?.email || null,
        status: 'open', converted_txn: null, first_saved_at: now, updated_at: now, last_seen_at: now,
        last_path: path, visits: 1, country, device,
      }, { onConflict: 'browser_id' });
      return ok();
    }
    await db.from('cart_snapshots').update({
      ...(sig !== prevSig ? { items, item_count: items.length, total_usd: total, updated_at: now } : {}),
      ...(em ? { email: em } : {}),
      last_seen_at: now, last_path: path, visits: Number(prev.visits || 0) + (b.view ? 1 : 0), device,
    }).eq('browser_id', bid);
    return ok();
  } catch {
    return ok();
  }
};
