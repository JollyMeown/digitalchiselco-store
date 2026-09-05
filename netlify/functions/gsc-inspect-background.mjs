// Netlify BACKGROUND function (15-minute limit): inspects a slice of sitemap
// URLs with the Search Console URL Inspection API and stores each verdict in
// gsc_url_status. The nightly run does 250 a night on its own; this is the
// admin "Audit now" button, which asks for a bigger slice.
//
//   POST /.netlify/functions/gsc-inspect-background?max=600
//   authorization: Bearer $CRON_SECRET
import crypto from 'node:crypto';
import { gscConfigured, gscInspectSlice } from '../../src/lib/search-console.ts';
import { telegramOwner } from '../../src/lib/notify.ts';

export default async (request) => {
  try {
    const secret = process.env.CRON_SECRET || '';
    const auth = request.headers.get('authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const A = Buffer.from(bearer), B = Buffer.from(secret);
    if (!secret || !bearer || A.length !== B.length || !crypto.timingSafeEqual(A, B)) return new Response('unauthorized', { status: 401 });
    if (!gscConfigured()) return new Response('search console not configured', { status: 503 });
    const max = Math.max(1, Math.min(1800, Number(new URL(request.url).searchParams.get('max')) || 600));
    const t0 = Date.now();
    const status = await gscInspectSlice(max, { budgetMs: 13 * 60 * 1000 });
    console.log('[gsc-inspect]', status, 'in', Date.now() - t0, 'ms');
    return new Response(status, { status: 200 });
  } catch (e) {
    console.error('[gsc-inspect] failed:', e);
    try { await telegramOwner(`🔴 <b>Index audit failed</b>\n${String(e?.message || e).slice(0, 300)}`); } catch {}
    return new Response('failed', { status: 500 });
  }
};
