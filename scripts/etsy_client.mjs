// Shared Etsy Open API v3 client.
//
// Auth model:
//   - Public endpoints: x-api-key = "keystring:shared_secret" (keystring alone
//     returns 403 "Shared secret is required" for this seller-app type).
//   - OAuth endpoints: same x-api-key PLUS Authorization: Bearer <access_token>.
//     Access tokens live 1h; we mint fresh ones from the refresh token stored in
//     .etsy_token.json (created by scripts/etsy_oauth.mjs). Etsy ROTATES the
//     refresh token on every refresh, so we persist the new one each time.
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const TOKEN_FILE = new URL('../.etsy_token.json', import.meta.url);
export const KEYSTRING = process.env.ETSY_API_KEY?.split(':')[0] || '';

export function apiKeyHeader() {
  const key = process.env.ETSY_API_KEY || '';
  if (key.includes(':')) return key;
  const secret = process.env.ETSY_SHARED_SECRET || '';
  return secret ? `${key}:${secret}` : key;
}

function loadTokens() {
  if (!existsSync(TOKEN_FILE)) return null;
  try { return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}

export function saveTokens(t) {
  writeFileSync(TOKEN_FILE, JSON.stringify({ ...t, saved_at: new Date().toISOString() }, null, 2));
}

/** Returns a valid OAuth access token, refreshing (and rotating) as needed. Null if never authorized. */
export async function getAccessToken() {
  const t = loadTokens();
  if (!t?.refresh_token) return null;
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60_000) return t.access_token;
  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: KEYSTRING, refresh_token: t.refresh_token }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Etsy token refresh failed (${res.status}): ${JSON.stringify(json).slice(0, 300)} — re-run scripts/etsy_oauth.mjs`);
  }
  saveTokens({ access_token: json.access_token, refresh_token: json.refresh_token || t.refresh_token, expires_at: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
}

/** GET/POST against https://openapi.etsy.com/v3/application. oauth=true adds the Bearer token. */
export async function etsy(path, { oauth = false, method = 'GET', body } = {}) {
  const headers = { 'x-api-key': apiKeyHeader() };
  if (oauth) {
    const token = await getAccessToken();
    if (!token) throw new Error('No Etsy OAuth token — run: node scripts/etsy_oauth.mjs');
    headers.Authorization = `Bearer ${token}`;
  }
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Etsy ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
