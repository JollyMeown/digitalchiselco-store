// One-time Etsy OAuth 2.0 (PKCE) helper — mints the refresh token stored in
// .etsy_token.json that etsy_client.mjs uses for authenticated calls.
//
// Prereq: in your Etsy app settings (etsy.com/developers → your app), add this
// EXACT Callback URL:   http://localhost:3003/callback
//
// Run:  node scripts/etsy_oauth.mjs
//   1) It opens a local server and prints an etsy.com URL — open it in the
//      browser where you're logged in as the DigitalChiselCo shop owner.
//   2) Click "Grant access". Etsy redirects back to localhost and the script
//      finishes automatically — tokens land in .etsy_token.json (gitignored).
//
// Scopes: listings_r (read listings + attached files), listings_w (future
// draft-listing automation), shops_r, transactions_r (orders/stats).
import 'dotenv/config';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { KEYSTRING, saveTokens } from './etsy_client.mjs';

const PORT = 3003;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = 'listings_r listings_w shops_r transactions_r';

if (!KEYSTRING) { console.error('ETSY_API_KEY missing from .env'); process.exit(1); }

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));

const authUrl = 'https://www.etsy.com/oauth/connect'
  + `?response_type=code&client_id=${encodeURIComponent(KEYSTRING)}`
  + `&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(SCOPES)}`
  + `&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const code = url.searchParams.get('code');
  const gotState = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  if (err || !code || gotState !== state) {
    res.writeHead(400, { 'content-type': 'text/html' }).end('<h2>Authorization failed — check the terminal.</h2>');
    console.error('Callback error:', err || 'missing code / state mismatch');
    process.exit(1);
  }
  try {
    const tokenRes = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: KEYSTRING,
        redirect_uri: REDIRECT, code, code_verifier: verifier,
      }).toString(),
    });
    const json = await tokenRes.json();
    if (!tokenRes.ok || !json.access_token) throw new Error(JSON.stringify(json).slice(0, 400));
    saveTokens({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + (json.expires_in || 3600) * 1000,
    });
    res.writeHead(200, { 'content-type': 'text/html' })
      .end('<h2 style="font-family:sans-serif">✅ Etsy connected — you can close this tab.</h2>');
    console.log('\n✅ Success! Tokens saved to .etsy_token.json (refresh token auto-rotates on use).');
    console.log('   Authorized user id:', String(json.access_token).split('.')[0]);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html' }).end('<h2>Token exchange failed — check the terminal.</h2>');
    console.error('\n❌ Token exchange failed:', e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('\n1) Make sure your Etsy app has this Callback URL:  ' + REDIRECT);
  console.log('\n2) Open this URL (logged in as the shop owner) and click "Grant access":\n');
  console.log('   ' + authUrl + '\n');
  console.log('Waiting for the Etsy redirect on ' + REDIRECT + ' ...');
});
