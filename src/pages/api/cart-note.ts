// Abandoned-cart capture: the cart page posts {email, items} when the buyer
// types their email. If they never complete payment, the daily cron sends one
// (and only one) reminder — gated by the admin "cart reminders" toggle.

import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase';
import { send as sendEmail } from '../../lib/resend';
import { telegramOwner } from '../../lib/notify';
import { rateLimit, clientIp } from '../../lib/rate-limit';

export const prerender = false;
const OPS_INBOX = 'jolly@digitalchiselco.com';
const BIG_CART_USD = 40;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return new Response(null, { status: 204 });
    if (!(await rateLimit(`cartnote:${clientIp(request)}`, 20, 600))) return new Response(null, { status: 204 });

    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map((x: any) => ({
      id: String(x.id || '').slice(0, 60),
      title: String(x.title || '').slice(0, 160),
      price: Number(x.price) || 0,
      qty: Math.max(1, Number(x.qty) || 1),
    })).filter((x: any) => x.id && x.title);
    if (!items.length) return new Response(null, { status: 204 });
    const subtotal = items.reduce((s: number, x: any) => s + x.price * x.qty, 0);

    const db = supabaseAdmin();
    // one open row per email (unique partial index) — refresh it on every note.
    // SECURITY: exact match, never a LIKE pattern. `.ilike` here let a single
    // request with email "%@%.%" overwrite EVERY open cart in the table (and
    // the reminder automation would then mail all those customers the
    // attacker's item titles). Emails are stored lowercase everywhere.
    const { error } = await db.from('abandoned_carts')
      .update({ cart: items, subtotal, updated_at: new Date().toISOString() })
      .eq('email', email).is('recovered_at', null);
    // update touches 0 rows when there is no open cart yet → insert
    const { data: existing } = await db.from('abandoned_carts').select('id').eq('email', email).is('recovered_at', null).limit(1);
    if (!existing?.length) await db.from('abandoned_carts').insert({ email, cart: items, subtotal });
    void error;

    // ── Anonymous→known identity bridge ────────────────────────────────
    // The visitor just identified themselves. Stamp today's visitor hash →
    // email so admin analytics can attach a name to today's on-site events.
    // Hash formula matches /api/track exactly (rotates daily by design).
    try {
      const ua = request.headers.get('user-agent') || '';
      const day = new Date().toISOString().slice(0, 10);
      const secret = process.env.ACCOUNT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'trk';
      const vh = crypto.createHash('sha256').update(`${clientIp(request)}|${ua}|${day}|${secret}`).digest('hex').slice(0, 32);
      await db.from('visitor_identities').upsert({ visitor_hash: vh, email }, { onConflict: 'visitor_hash' });
    } catch { /* best-effort */ }

    // ── Owner alert: a serious cart just appeared ──────────────────────
    // One ping per email per day, only above the threshold, only when the
    // Automations toggle is on. Best-effort — never blocks the response.
    try {
      if (subtotal >= BIG_CART_USD) {
        const { data: g } = await db.from('growth_settings').select('owner_alerts_enabled').eq('id', 1).maybeSingle();
        if (g?.owner_alerts_enabled) {
          const list = items.slice(0, 8).map((x: any) => `• ${x.title} ($${x.price.toFixed(2)})`).join('<br/>');
          await sendEmail({
            to: OPS_INBOX,
            subject: `🛒 Big cart right now: $${subtotal.toFixed(2)} (${items.length} items) — ${email}`,
            html: `<p><strong>${email}</strong> just built a $${subtotal.toFixed(2)} cart:</p><p>${list}</p><p>They are on the site right now. If they do not finish, the abandoned-cart reminder handles it tomorrow.</p>`,
            text: `${email} built a $${subtotal.toFixed(2)} cart (${items.length} items).`,
            idempotencyKey: `bigcart:${email}:${new Date().toISOString().slice(0, 10)}`,
          });
          await telegramOwner(`🛒 <b>Big cart RIGHT NOW: $${subtotal.toFixed(2)}</b>\n${email} · ${items.length} items\nThey are on the site this second.`);
        }
      }
    } catch { /* best-effort */ }

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
};
