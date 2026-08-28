// First-party pageview beacon. Called by a tiny inline script in Base.astro
// via navigator.sendBeacon. Stores NO cookies and NO raw IPs — the visitor
// hash is sha256(ip + UA + day + secret), which lets the admin count daily
// unique visitors without any personally identifiable data.

import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp } from '../../lib/rate-limit';

export const prerender = false;

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pingdom|uptime|monitor|facebookexternal|preview|scrapy|python-requests|curl|wget/i;

function deviceOf(ua: string): string {
  if (BOT_RE.test(ua)) return 'bot';
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function countryOf(req: Request): string | null {
  // Netlify exposes geo differently across runtimes — check the common spots.
  const direct = req.headers.get('x-country') || req.headers.get('cf-ipcountry');
  if (direct) return direct.toUpperCase().slice(0, 2);
  const nf = req.headers.get('x-nf-geo');
  if (nf) {
    try { const g = JSON.parse(Buffer.from(nf, 'base64').toString('utf8')); return (g?.country?.code || '').toUpperCase().slice(0, 2) || null; }
    catch { try { const g = JSON.parse(nf); return (g?.country?.code || '').toUpperCase().slice(0, 2) || null; } catch { return null; } }
  }
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    let path = String(body.p || '/').slice(0, 200);
    if (!path.startsWith('/')) path = '/' + path;
    // never track the admin or api surface
    if (path.startsWith('/admin') || path.startsWith('/api')) return new Response(null, { status: 204 });

    const ip = clientIp(request);
    if (!(await rateLimit(`track:${ip}`, 120, 300))) return new Response(null, { status: 204 });

    const ua = request.headers.get('user-agent') || '';
    const device = deviceOf(ua);
    if (device === 'bot') return new Response(null, { status: 204 });

    // Funnel events (t != 'pv') land in site_events instead of site_visits.
    const type = String(body.t || 'pv');
    if (type !== 'pv') {
      if (!['view_product', 'add_to_cart', 'buy_now', 'wishlist_add', 'wishlist_remove', 'checkout_start', 'lamp_try'].includes(type)) return new Response(null, { status: 204 });
      const day0 = new Date().toISOString().slice(0, 10);
      const secret0 = process.env.ACCOUNT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'trk';
      const vh = crypto.createHash('sha256').update(`${ip}|${ua}|${day0}|${secret0}`).digest('hex').slice(0, 32);
      const pid = typeof body.pid === 'string' && /^[0-9a-f-]{36}$/i.test(body.pid) ? body.pid : null;
      await supabaseAdmin().from('site_events').insert({ day: day0, type, path, product_id: pid, visitor_hash: vh });
      // Abandoned-browse: if the visitor has already given us their email
      // (cart/subscribe), log the viewed product against it so the cron can
      // remind browsers who never carted. No email → nothing stored.
      if (type === 'view_product' && pid) {
        const em = typeof body.em === 'string' ? body.em.toLowerCase().trim() : '';
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
          try { await supabaseAdmin().from('browse_events').insert({ email: em, product_id: pid }); } catch { /* best-effort */ }
        }
      }
      return new Response(null, { status: 204 });
    }

    let referrer_host: string | null = null;
    try {
      const ref = String(body.r || '');
      if (ref) {
        const host = new URL(ref).hostname.replace(/^www\./, '');
        // internal navigation isn't a referral
        if (!/digitalchiselco\.com$/i.test(host)) referrer_host = host.slice(0, 120);
      }
    } catch { /* ignore bad referrer */ }

    const day = new Date().toISOString().slice(0, 10);
    const secret = process.env.ACCOUNT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'trk';
    const visitor_hash = crypto.createHash('sha256').update(`${ip}|${ua}|${day}|${secret}`).digest('hex').slice(0, 32);

    // Campaign tag from ?src= / utm_* (sanitized: tag-like strings only).
    const rawCamp = String(body.c || '').toLowerCase();
    const campaign = /^[a-z0-9][a-z0-9._-]{1,59}$/.test(rawCamp) ? rawCamp : null;

    await supabaseAdmin().from('site_visits').insert({ day, path, referrer_host, device, country: countryOf(request), visitor_hash, campaign });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });   // analytics must never error a page
  }
};
