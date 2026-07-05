// One-time Pinterest OAuth helper — mints the refresh token the publisher needs.
//
// Prereqs: create an app at https://developers.pinterest.com/apps/, and add a
// Redirect URI in the app settings that EXACTLY matches the one below (default
// https://digitalchiselco.com/). Put the app credentials in .env:
//   PINTEREST_APP_ID=...
//   PINTEREST_APP_SECRET=...
//
// Run:  node scripts/pinterest_oauth.mjs
//   1) Open the printed URL (logged in as the DigitalChiselCo Pinterest account)
//      and click "Give access".
//   2) Pinterest redirects to <redirect>?code=XXXX — copy the code (or the whole
//      redirected URL) and paste it back here.
//   3) The script prints PINTEREST_REFRESH_TOKEN — store it in .env and as a
//      GitHub Actions secret.
//
// Optional flags: --redirect <uri>  (must match an app Redirect URI)

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const API = 'https://api.pinterest.com/v5';
const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const APP_ID = process.env.PINTEREST_APP_ID || val('--app-id', '');
const APP_SECRET = process.env.PINTEREST_APP_SECRET || val('--app-secret', '');
const REDIRECT = val('--redirect', process.env.PINTEREST_REDIRECT_URI || 'https://digitalchiselco.com/');
const SCOPES = 'boards:read,boards:write,pins:read,pins:write';

if (!APP_ID || !APP_SECRET) {
  console.error('Set PINTEREST_APP_ID and PINTEREST_APP_SECRET in .env (or pass --app-id / --app-secret).');
  process.exit(1);
}

const authUrl = `https://www.pinterest.com/oauth/?client_id=${encodeURIComponent(APP_ID)}`
  + `&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=${encodeURIComponent(SCOPES)}`;

console.log('\n1) Open this URL in your browser (logged in as your DigitalChiselCo Pinterest account) and click "Give access":\n');
console.log('   ' + authUrl);
console.log(`\n2) Pinterest will redirect to  ${REDIRECT}?code=XXXX  — copy the code from the address bar.`);
console.log(`   (The redirect URI above must EXACTLY match one configured in your Pinterest app settings.)\n`);

const rl = createInterface({ input, output });
let code = (await rl.question('Paste the code (or the full redirected URL): ')).trim();
rl.close();

const m = code.match(/[?&]code=([^&\s]+)/);
if (m) code = m[1];
try { code = decodeURIComponent(code); } catch { /* already decoded */ }

const res = await fetch(`${API}/oauth/token`, {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }).toString(),
});

const text = await res.text();
let json; try { json = JSON.parse(text); } catch { console.error('Non-JSON response:', res.status, text.slice(0, 400)); process.exit(1); }
if (!res.ok || !json.refresh_token) {
  console.error('\n❌ Token exchange failed (', res.status, '):\n', JSON.stringify(json, null, 2));
  console.error('\nCommon causes: redirect URI mismatch, expired/one-time code (re-run and paste a fresh one), or missing scopes.');
  process.exit(1);
}

console.log('\n✅ Success! Add this to .env AND to your GitHub repo secrets:\n');
console.log('PINTEREST_REFRESH_TOKEN=' + json.refresh_token);
console.log(`\n(A short-lived access token was also issued, expiring in ${json.expires_in}s — the publisher mints fresh ones from the refresh token automatically, so you only need the refresh token.)`);
console.log('\nNext:');
console.log('  1. Add PINTEREST_APP_ID, PINTEREST_APP_SECRET, PINTEREST_REFRESH_TOKEN to GitHub secrets.');
console.log('  2. Find your board id:  node scripts/pinterest_publish.mjs --list-boards');
console.log('  3. Add PINTEREST_BOARD_ID to GitHub secrets.');
