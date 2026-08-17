// Self-service "resend my downloads": buyer enters their email, we email their
// whole library of paid download links. Non-revealing (always the same reply,
// whether or not the email has orders), rate-limited, and deduped to one send
// per email per day via the Resend idempotency key.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { send as sendEmail } from '../../lib/resend';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const OK_MSG = 'If that email has orders with us, your download links are on their way. Check your inbox (and spam) in a minute or two.';
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!(await rateLimit(`resenddl:ip:${ip}`, 5, 3600))) return tooMany('Too many requests. Please try again in an hour.');

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Please enter a valid email.' }, 400);

  const db = supabaseAdmin();
  try {
    // Everything they're entitled to: paid orders' items + entitlement-only
    // grants (gift recipients have entitlements but no order row).
    const { data: orders } = await db.from('orders')
      .select('id, created_at, status, order_items(title, product_id, products(is_customizable))')
      .eq('email', email).eq('status', 'paid')
      .order('created_at', { ascending: false }).limit(60);
    const { data: ents } = await db.from('entitlements').select('product_id').eq('email', email).limit(500);

    const productIds = new Set<string>();
    for (const o of orders || []) for (const it of (o as any).order_items || []) {
      if (it.product_id && !it.products?.is_customizable) productIds.add(it.product_id);
    }
    for (const e of ents || []) if (e.product_id) productIds.add(e.product_id);

    if (!productIds.size) return json({ ok: true, message: OK_MSG });   // non-revealing

    const ids = [...productIds];
    const [{ data: prods }, { data: dls }] = await Promise.all([
      db.from('products').select('id, title').in('id', ids),
      db.from('product_downloads').select('product_id, file_name, download_link').in('product_id', ids),
    ]);
    const titleById = new Map((prods || []).map((p: any) => [p.id, String(p.title).split('|')[0].trim()]));
    const linksById = new Map<string, { name: string | null; url: string }[]>();
    for (const dl of dls || []) {
      const arr = linksById.get(dl.product_id) || [];
      arr.push({ name: dl.file_name || null, url: dl.download_link });
      linksById.set(dl.product_id, arr);
    }

    const rows = ids.filter((id) => linksById.has(id)).map((id) => {
      const links = (linksById.get(id) || []).map((l) =>
        `<a href="${esc(l.url)}" style="display:inline-block;background:#854F0B;color:#F5EFE3;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:13px;margin:4px 6px 0 0;">⬇ ${esc(l.name || 'Download')}</a>`).join('');
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #eee;">
        <div style="font-size:14px;color:#2A1A0E;font-weight:500;">${esc(titleById.get(id) || 'Design')}</div>
        <div>${links}</div></td></tr>`;
    }).join('');
    if (!rows) return json({ ok: true, message: OK_MSG });

    const html = `<div style="max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;">
      <div style="background:#5E380A;color:#F5EFE3;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <div style="font-size:11px;letter-spacing:2px;color:#FAC775;text-transform:uppercase;">DigitalChiselCo</div>
        <h1 style="margin:6px 0 0;font-family:Georgia,serif;font-size:24px;color:#fff;">Your download library</h1>
      </div>
      <div style="background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;padding:20px 24px;">
        <p style="font-size:14px;color:#555;line-height:1.6;">Here is everything you own, all in one place. These links do not expire, keep this email handy.</p>
        <table role="presentation" width="100%">${rows}</table>
        <p style="font-size:13px;color:#999;margin-top:16px;">You can also sign in anytime at <a href="${SITE}/account" style="color:#854F0B;">${SITE.replace('https://', '')}/account</a>. Need help? Just reply, a real person reads every message.</p>
      </div></div>`;
    const text = `Your DigitalChiselCo download library:\n\n` +
      ids.filter((id) => linksById.has(id)).map((id) => `${titleById.get(id) || 'Design'}\n${(linksById.get(id) || []).map((l) => `  ${l.url}`).join('\n')}`).join('\n\n') +
      `\n\nOr sign in at ${SITE}/account`;

    await sendEmail({
      to: email,
      subject: 'Your DigitalChiselCo downloads, all in one place',
      html, text,
      idempotencyKey: `resendlib:${email}:${new Date().toISOString().slice(0, 10)}`,
      tags: [{ name: 'kind', value: 'resendLibrary' }],
    });
    return json({ ok: true, message: OK_MSG });
  } catch (e: any) {
    console.error('[resend-downloads]', e?.message);
    return json({ ok: true, message: OK_MSG });   // still non-revealing on errors
  }
};
