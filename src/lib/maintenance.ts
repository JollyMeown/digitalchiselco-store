// "Back in a few minutes" page, for when the site cannot reach its database.
//
// Owner, 2026-09-21, after Supabase ran out of CPU on a nano instance and
// stopped answering queries: "next time site is down like that we should put a
// banner that site is under maintenance". Until now a failed query bubbled up
// as a Netlify 502, which shows the visitor a raw platform error page with our
// domain on it. This serves our own page instead, on our own brand, with the
// right status code so Google treats it as temporary and keeps the ranking.
//
// Two ways in:
//  1. Automatic. The middleware catches a thrown page render or a 5xx and
//     serves this instead. Nothing to switch on, it is always armed.
//  2. Manual. Set MAINTENANCE_MODE=1 in Netlify (Site configuration →
//     Environment variables) and redeploy, for planned work. Unset to lift it.
//     A manual flag cannot live in the database: the database is the thing
//     most likely to be down.

const PAGE = (planned: boolean) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="45">
<title>Back shortly · DigitalChiselCo</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#FAEEDA; color:#3a2a1a; padding:24px;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .box { max-width:520px; width:100%; background:#fff; border:1px solid rgba(0,0,0,.09);
         border-radius:18px; padding:38px 30px; text-align:center;
         box-shadow:0 10px 34px rgba(65,36,2,.09); }
  h1 { font-family:Fraunces,Georgia,serif; font-weight:600; color:#412402;
       font-size:clamp(23px,5vw,30px); margin:18px 0 10px; line-height:1.2; }
  p { margin:0 0 14px; font-size:15px; line-height:1.62; color:rgba(58,42,26,.82); }
  .chisel { width:54px; height:54px; margin:0 auto; display:block; }
  .note { margin-top:24px; padding-top:20px; border-top:1px solid rgba(0,0,0,.08);
          font-size:13.5px; color:rgba(58,42,26,.62); }
  a { color:#854F0B; font-weight:600; }
  .pulse { display:inline-block; width:8px; height:8px; border-radius:50%; background:#854F0B;
           margin-right:8px; vertical-align:middle; animation:p 1.6s ease-in-out infinite; }
  @keyframes p { 0%,100% { opacity:1 } 50% { opacity:.25 } }
  @media (prefers-reduced-motion: reduce) { .pulse { animation:none } }
</style></head>
<body>
  <main class="box">
    <svg class="chisel" viewBox="0 0 24 24" fill="none" stroke="#854F0B" stroke-width="1.4"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14.7 3.3a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4l-2.1 2.1-6-6z"/>
      <path d="M12.6 5.4 3.9 14.1a2 2 0 0 0-.5.9l-1.2 4.6a.7.7 0 0 0 .9.9l4.6-1.2a2 2 0 0 0 .9-.5l8.7-8.7z"/>
    </svg>
    <h1>${planned ? 'Back in a few minutes' : 'We are just catching our breath'}</h1>
    <p><span class="pulse"></span>${planned
      ? 'The shop is closed for a short spell of planned maintenance.'
      : 'The shop cannot reach its library of designs at this moment. This is almost always over within a few minutes.'}</p>
    <p>This page refreshes itself, so you can leave it open and it will come back on its own.</p>
    <div class="note">
      Nothing is lost. Orders already placed are safe, and every design you have bought stays in
      your account and in your email download links.<br><br>
      If you were in the middle of buying something, or you need a file right now, write to
      <a href="mailto:support@digitalchiselco.com">support@digitalchiselco.com</a> and Jolly will sort it out.
    </div>
  </main>
</body></html>`;

/** Is the manual switch on? Set MAINTENANCE_MODE=1 in the Netlify environment. */
export function plannedMaintenance(): boolean {
  try {
    const v = String((import.meta as any).env?.MAINTENANCE_MODE ?? (globalThis as any).process?.env?.MAINTENANCE_MODE ?? '').trim();
    return v === '1' || v.toLowerCase() === 'true';
  } catch { return false; }
}

/**
 * 503 with Retry-After, never cached. 503 is the correct code: Google retries
 * it and holds the ranking, where a 500 or a 404 can cost the page its place.
 */
export function maintenancePage(planned = false): Response {
  return new Response(PAGE(planned), {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'retry-after': '120',
      'cache-control': 'no-store, must-revalidate',
      'netlify-cdn-cache-control': 'no-store',
    },
  });
}

/** Same situation, for an API route, so front-end code gets JSON not HTML. */
export function maintenanceJson(planned = false): Response {
  return new Response(JSON.stringify({
    ok: false,
    error: planned ? 'planned_maintenance' : 'temporarily_unavailable',
    message: planned
      ? 'The site is down for short planned maintenance. Please try again in a few minutes.'
      : 'The site cannot reach its database right now. Please try again in a few minutes.',
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json',
      'retry-after': '120',
      'cache-control': 'no-store, must-revalidate',
      'netlify-cdn-cache-control': 'no-store',
    },
  });
}
