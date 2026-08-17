// Netlify Scheduled Function — fires the membership automation once a day.
// It simply calls the site's own /api/cron/daily endpoint with the shared
// CRON_SECRET, so all the logic lives in the Astro app (one code path, easy to
// test manually). Configure CRON_SECRET in Netlify env vars.
//
// Schedule: 08:00 UTC daily. Change the cron below + redeploy to adjust.

export const config = { schedule: '0 8 * * *' };

export default async () => {
  const site = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[daily-drop] CRON_SECRET not set — skipping');
    return new Response('missing CRON_SECRET', { status: 200 });
  }
  try {
    // GET, not POST: Astro's CSRF guard rejects cross-site POSTs with 403
    // ("Cross-site POST form submissions are forbidden") — which silently
    // killed every scheduled run. The endpoint accepts GET with the same
    // Bearer header, so auth is unchanged and the secret stays out of the URL.
    const res = await fetch(`${site}/api/cron/daily`, {
      method: 'GET',
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = await res.text();
    console.log('[daily-drop]', res.status, body.slice(0, 500));
  } catch (e) {
    console.error('[daily-drop] fetch failed', e);
  }
  return new Response('ok', { status: 200 });
};
