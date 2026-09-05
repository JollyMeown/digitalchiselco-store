// Tracked pack link: logs the download, then sends the member on to Drive.
// Signed per (membership, month, kind), so the Drive link itself never appears
// in an email and a link cannot be edited into somebody else's pack.
import type { APIRoute } from 'astro';
import { resolvePackClick } from '../../../lib/subscriptions';

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) => {
  const q = {
    s: url.searchParams.get('s') || '', m: url.searchParams.get('m') || '', k: url.searchParams.get('k') || 'standard',
    v: url.searchParams.get('v') || 'email', t: url.searchParams.get('t') || '', ua: request.headers.get('user-agent') || '',
  };
  const r = await resolvePackClick(q);
  if ('error' in r) {
    return new Response(`<!doctype html><meta charset="utf-8"><title>DigitalChiselCo</title>
<body style="font-family:Helvetica,Arial,sans-serif;background:#F5EFE3;color:#2A1A0E;padding:40px;text-align:center">
<h2 style="font-family:Georgia,serif">This pack link did not work</h2><p>${r.error}.</p>
<p><a href="/account" style="color:#854F0B">Open your account</a> to find every pack, or reply to the email and we will sort it.</p></body>`,
      { status: r.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return new Response(null, { status: 302, headers: { location: r.url, 'cache-control': 'no-store' } });
};
