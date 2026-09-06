// Harvest Etsy buyer emails from the Gmail account(s) that receive the shop's
// sale notifications, into a CSV that import_etsy_buyers.mjs understands.
// Read-only Gmail access, approved once per account in the browser (Google
// OAuth, same idea as scripts/etsy_oauth.mjs). Nothing is sent or changed.
//
// ONE-TIME SETUP (5 minutes, Google Cloud console, project bas-relief-factory):
//   1. APIs & Services > Library > enable "Gmail API".
//   2. APIs & Services > OAuth consent screen: External, add each Gmail address
//      you will scan under "Test users" (testing mode is fine).
//   3. APIs & Services > Credentials > Create credentials > OAuth client ID >
//      Application type "Desktop app" > Download JSON > save it as
//        D:\000 DIGITAL CHISEL WEBSITE\.gmail_client.json   (git-ignored)
//
// RUN (once per Gmail account):
//   node scripts/gmail_etsy_buyers.mjs --account=you@gmail.com            # scan + write CSV
//   node scripts/gmail_etsy_buyers.mjs --account=you@gmail.com --since=2024-01-01
//   then:  node scripts/import_etsy_buyers.mjs "<csv path printed>" --apply
//
// What it looks for: every message from etsy.com whose subject or body
// contains an email address that is not Etsy's or ours. Etsy masks some
// buyer addresses (a***@gmail.com); those are listed but cannot be used.
import 'dotenv/config';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const ACCOUNT = arg('account');
const SINCE = arg('since');
const ROOT = new URL('../', import.meta.url);
const CLIENT_FILE = new URL('.gmail_client.json', ROOT);
const TOKEN_FILE = new URL(`.gmail_token_${(ACCOUNT || 'default').replace(/[^a-z0-9]/gi, '_')}.json`, ROOT);
const PORT = 3004, REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const OUR = /@(etsy\.com|etsy\.me|digitalchiselco\.com|google\.com|gmail\.com$)/i;   // gmail.com only when it is OUR own account below
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(CLIENT_FILE)) { console.error('Missing .gmail_client.json (see the setup steps at the top of this file).'); process.exit(1); }
const client = JSON.parse(readFileSync(CLIENT_FILE, 'utf8'));
const { client_id, client_secret } = client.installed || client.web || client;

// ── OAuth: refresh token on disk, else browser approval once ──
async function accessToken() {
  let tok = existsSync(TOKEN_FILE) ? JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) : null;
  if (tok?.refresh_token) {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id, client_secret, refresh_token: tok.refresh_token, grant_type: 'refresh_token' }) });
    const j = await r.json();
    if (j.access_token) return j.access_token;
    console.warn('refresh failed, approving again:', j.error_description || j.error);
  }
  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': 'text/html' }).end('<h2 style="font-family:sans-serif">Gmail connected. You can close this tab.</h2>');
      server.close(); u.searchParams.get('code') ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error') || 'no code'));
    }).listen(PORT);
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', ...(ACCOUNT ? { login_hint: ACCOUNT } : {}) });
    console.log('\nApprove read-only Gmail access in the browser (opening):\n' + url + '\n');
    spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore' }).unref();
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, code, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('token exchange failed: ' + JSON.stringify(j));
  writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: j.refresh_token, saved_at: new Date().toISOString() }, null, 2));
  return j.access_token;
}

const token = await accessToken();
const g = async (path) => { const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, { headers: { authorization: 'Bearer ' + token } }); if (r.status === 429) { await sleep(2000); return g(path); } const j = await r.json(); if (j.error) throw new Error(j.error.message); return j; };
const profile = await g('profile');
const me = String(profile.emailAddress || '').toLowerCase();
console.log(`Scanning ${me} (${profile.messagesTotal} messages in the mailbox)`);

// ── find Etsy sale notifications ──
const q = `from:etsy.com (sale OR sold OR order OR purchase OR "transaction")${SINCE ? ' after:' + SINCE.replace(/-/g, '/') : ''}`;
const ids = [];
let pageToken = '';
do {
  const j = await g(`messages?q=${encodeURIComponent(q)}&maxResults=500${pageToken ? '&pageToken=' + pageToken : ''}`);
  for (const m of j.messages || []) ids.push(m.id);
  pageToken = j.nextPageToken || '';
  process.stdout.write(`\r  found ${ids.length} messages…`);
} while (pageToken);
console.log('');

// ── read each one, pull addresses ──
const decode = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const textOf = (p) => { let out = ''; if (p.body?.data) out += decode(p.body.data) + '\n'; for (const c of p.parts || []) out += textOf(c); return out; };
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MASKED_RE = /[A-Z0-9._%+-]*\*+[A-Z0-9._%+-]*@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const buyers = new Map(), masked = new Set();
let n = 0;
for (const id of ids) {
  n++;
  try {
    const m = await g(`messages/${id}?format=full`);
    const headers = Object.fromEntries((m.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const body = (headers.subject || '') + '\n' + textOf(m.payload || {}).replace(/<[^>]+>/g, ' ');
    for (const e of body.match(MASKED_RE) || []) masked.add(e.toLowerCase());
    for (const raw of body.match(EMAIL_RE) || []) {
      const e = raw.toLowerCase();
      if (e === me || /@(etsy\.com|etsy\.me|digitalchiselco\.com|google\.com|googlemail\.com|youtube\.com|paypal\.com)$/i.test(e) || e.includes('*')) continue;
      if (/noreply|no-reply|donotreply|support@|help@|notifications?@|transaction@|convos?@/i.test(e)) continue;
      const when = new Date(Number(m.internalDate) || 0).toISOString().slice(0, 10);
      const b = buyers.get(e) || { first: when, last: when, count: 0, subject: headers.subject || '' };
      b.count++; if (when < b.first) b.first = when; if (when > b.last) b.last = when;
      buyers.set(e, b);
    }
  } catch (err) { console.error(`\n  message ${id}: ${String(err.message).slice(0, 80)}`); }
  if (n % 25 === 0) process.stdout.write(`\r  read ${n}/${ids.length}, buyers so far ${buyers.size}`);
  await sleep(60);
}
console.log(`\nDone. Messages read: ${ids.length} · unique buyer emails: ${buyers.size} · masked (unusable): ${masked.size}`);

const out = new URL(`../etsy_buyers_${me.split('@')[0]}_${new Date().toISOString().slice(0, 10)}.csv`, import.meta.url);
const rows = [...buyers.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([e, b]) => `${e},${b.first},${b.last},${b.count},"${b.subject.replace(/"/g, "'").slice(0, 80)}"`);
writeFileSync(out, 'email,first_seen,last_seen,messages,sample_subject\n' + rows.join('\n') + '\n');
console.log(`CSV written: ${decodeURIComponent(out.pathname.replace(/^\//, ''))}`);
console.log(`Next:  node scripts/import_etsy_buyers.mjs "${decodeURIComponent(out.pathname.replace(/^\//, ''))}" --apply`);
if (buyers.size) console.log('Sample:', [...buyers.keys()].slice(0, 5).join(', '));
