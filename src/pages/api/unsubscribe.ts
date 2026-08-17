// Unsubscribe from marketing emails (drip / followups / reminders / digests).
//
// Hardened 2026-08-17:
//   • GET only SHOWS a confirm page — it never changes state. Mail scanners
//     (Outlook SafeLinks, corporate gateways) prefetch every link in an email;
//     a state-changing GET was unsubscribing people who never clicked.
//   • POST performs the unsubscribe. This is also what Gmail/Yahoo's
//     one-click standard (List-Unsubscribe-Post) sends, so the header we now
//     attach to every marketing email works out of the box.
//   • Token is opaque (base64url email + HMAC) so the address is not in the URL
//     in plain text; legacy ?e=&s= links keep working (verified the same way).
//   • Constant-time signature compare.
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase';
import { unsubSig } from '../../lib/marketing-emails';

export const prerender = false;

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DigitalChiselCo</title>
  <body style="font-family:Helvetica,Arial,sans-serif;background:#F5EFE3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="background:#fff;border:1px solid #E5DDD0;border-radius:12px;padding:36px;max-width:440px;text-align:center">${body}
  <p style="color:#666;font-size:13px;margin-top:18px">Order and download emails are unaffected.</p>
  <a href="https://digitalchiselco.com" style="color:#854F0B;font-size:13px">digitalchiselco.com</a></div>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

const safeEq = (a: string, b: string) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

// Accepts either the opaque token (?t=) or the legacy pair (?e=&s=).
function resolveEmail(params: URLSearchParams | FormData): string | null {
  const get = (k: string) => { const v = params.get(k); return typeof v === 'string' ? v : ''; };
  const t = get('t');
  if (t) {
    const [b64, sig] = t.split('.');
    if (!b64 || !sig) return null;
    let email = '';
    try { email = Buffer.from(b64, 'base64url').toString('utf8').toLowerCase().trim(); } catch { return null; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
    return safeEq(sig, unsubSig(email)) ? email : null;
  }
  const email = get('e').toLowerCase().trim();
  const sig = get('s');
  if (!email || !sig || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return safeEq(sig, unsubSig(email)) ? email : null;
}

async function doUnsubscribe(email: string) {
  const db = supabaseAdmin();
  await db.from('subscribers').update({ unsubscribed_at: new Date().toISOString() }).eq('email', email).is('unsubscribed_at', null);
  await db.from('subscriber_drip').update({ status: 'stopped' }).eq('email', email).eq('status', 'active');
}

// GET: confirm page (no state change). Carries the token forward into a POST.
export const GET: APIRoute = async ({ url }) => {
  const email = resolveEmail(url.searchParams);
  if (!email) return html(`<h2 style="color:#5E380A;font-family:Georgia,serif;margin:0 0 10px">That link is not valid.</h2>`, 400);
  const t = url.searchParams.get('t') || '';
  const e = url.searchParams.get('e') || '', s = url.searchParams.get('s') || '';
  const masked = email.replace(/^(.{2}).+(@.+)$/, '$1***$2');
  return html(`
    <h2 style="color:#5E380A;font-family:Georgia,serif;margin:0 0 10px">Unsubscribe from marketing emails?</h2>
    <p style="color:#555;font-size:14px;margin:0 0 18px">${masked}</p>
    <form method="post" action="/api/unsubscribe">
      ${t ? `<input type="hidden" name="t" value="${t.replace(/"/g, '&quot;')}">` : `<input type="hidden" name="e" value="${e.replace(/"/g, '&quot;')}"><input type="hidden" name="s" value="${s.replace(/"/g, '&quot;')}">`}
      <button type="submit" style="background:#854F0B;color:#F5EFE3;border:none;border-radius:8px;padding:12px 26px;font-size:15px;cursor:pointer">Yes, unsubscribe me</button>
    </form>`);
};

// POST: performs the unsubscribe. Accepts form posts (our confirm page and
// Gmail/Yahoo one-click, which sends List-Unsubscribe=One-Click as form data)
// and JSON.
export const POST: APIRoute = async ({ request, url }) => {
  let params: URLSearchParams | FormData = url.searchParams;
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) params = await request.formData();
    else if (ct.includes('application/json')) { const j = await request.json(); params = new URLSearchParams(Object.entries(j || {}).map(([k, v]) => [k, String(v)])); }
  } catch { /* fall back to query params */ }
  // If the body carried nothing usable, allow the token in the query string
  // (one-click clients POST to the exact List-Unsubscribe URL).
  let email = resolveEmail(params);
  if (!email) email = resolveEmail(url.searchParams);
  if (!email) return html(`<h2 style="color:#5E380A;font-family:Georgia,serif;margin:0 0 10px">That link is not valid.</h2>`, 400);
  await doUnsubscribe(email);
  return html(`<h2 style="color:#5E380A;font-family:Georgia,serif;margin:0 0 10px">You're unsubscribed from marketing emails.</h2>`);
};
