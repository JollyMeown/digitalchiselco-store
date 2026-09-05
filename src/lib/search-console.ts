// Google Search Console performance (clicks / impressions / position) per day,
// per page and per query, so Admin can see which blog posts and designs earn
// organic search traffic without opening Search Console.
//
// Auth: the SAME service account that reads Merchant Center (GOOGLE_SA_EMAIL +
// GOOGLE_SA_PRIVATE_KEY). New service-account keys are blocked by the Google
// Cloud org policy, so the existing robot user is added to the Search Console
// property instead. Same RS256 JWT bearer flow as google-merchant.ts, with the
// Search Console read-only scope.
//
// Setup (owner, one time):
//   1. Search Console > Settings > Users and permissions > Add user: the
//      service account email (shown in Admin > Traffic), permission Full.
//   2. Google Cloud > APIs & Services > Library > "Google Search Console API"
//      > Enable, in the project that owns the service account.
//
// Optional env: GSC_SITE (default sc-domain:digitalchiselco.com)
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const env = (n: string) => process.env[n] ?? (import.meta as any).env?.[n];
const API = 'https://www.googleapis.com/webmasters/v3';

export function gscConfigured(): boolean {
  return !!(env('GOOGLE_SA_EMAIL') && env('GOOGLE_SA_PRIVATE_KEY'));
}
export function gscServiceAccountEmail(): string | null {
  return env('GOOGLE_SA_EMAIL') ? String(env('GOOGLE_SA_EMAIL')) : null;
}
export function gscSite(): string {
  return String(env('GSC_SITE') || 'sc-domain:digitalchiselco.com');
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

async function accessToken(): Promise<string> {
  const email = String(env('GOOGLE_SA_EMAIL'));
  const key = String(env('GOOGLE_SA_PRIVATE_KEY')).replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signature = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${signature}` }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`token: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}

type SaRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
const iso = (d: Date) => d.toISOString().slice(0, 10);

// One Search Analytics query, following the 25,000-row pages to the end.
// dataState 'all' includes the freshest (still partial) two days; the rolling
// re-sync overwrites them once Google finalises the numbers.
async function query(token: string, body: Record<string, unknown>, maxRows = 100000): Promise<SaRow[]> {
  const site = encodeURIComponent(gscSite());
  const out: SaRow[] = [];
  let startRow = 0;
  for (;;) {
    const res = await fetch(`${API}/sites/${site}/searchAnalytics/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'web', dataState: 'all', rowLimit: 25000, startRow, ...body }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`searchAnalytics: ${res.status} ${text.slice(0, 300)}`);
    const rows: SaRow[] = (JSON.parse(text || '{}').rows || []);
    out.push(...rows);
    if (rows.length < 25000 || out.length >= maxRows) break;
    startRow += 25000;
  }
  return out;
}

const num = (r: SaRow) => ({ clicks: Math.round(r.clicks || 0), impressions: Math.round(r.impressions || 0), ctr: Number(r.ctr || 0), position: Number(r.position || 0) });

async function upsertChunks(db: any, table: string, rows: any[], onConflict: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 1000), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    n += Math.min(1000, rows.length - i);
  }
  return n;
}

// Fetch + upsert. `days` is the rolling window re-pulled (Search Console data
// finalises ~3 days late, so the nightly run uses 14; the first backfill uses
// up to 480). Returns a short status string for the cron ledger.
export async function syncSearchConsole(days = 14, opts: { budgetMs?: number } = {}): Promise<string> {
  const { supabaseAdmin } = await import('./supabase');
  const db = supabaseAdmin();
  const started = Date.now();
  const budget = opts.budgetMs ?? 13 * 60 * 1000;
  const left = () => budget - (Date.now() - started);
  const startDate = iso(new Date(Date.now() - days * 86400000));
  const endDate = iso(new Date());
  try {
    const token = await accessToken();
    const fetched_at = new Date().toISOString();

    // 1) totals per day: one request, always completes
    const daily = await query(token, { startDate, endDate, dimensions: ['date'] });
    const d = await upsertChunks(db, 'gsc_daily', daily.map((r) => ({ day: r.keys![0], ...num(r), fetched_at })), 'day');

    // 2) per page per day (the blog scoreboard)
    let p = 0;
    if (left() > 20000) {
      const rows = await query(token, { startDate, endDate, dimensions: ['date', 'page'] });
      p = await upsertChunks(db, 'gsc_page_daily', rows.map((r) => ({ day: r.keys![0], page: r.keys![1], ...num(r) })), 'day,page');
    }

    // 3) per query per day
    let q = 0;
    if (left() > 20000) {
      const rows = await query(token, { startDate, endDate, dimensions: ['date', 'query'] });
      q = await upsertChunks(db, 'gsc_query_daily', rows.map((r) => ({ day: r.keys![0], query: r.keys![1], ...num(r) })), 'day,query');
    }

    // 4) query x page, rolling 28 days, replaced whole so stale pairs vanish
    let pq = 0;
    if (left() > 20000) {
      const rows = await query(token, { startDate: iso(new Date(Date.now() - 28 * 86400000)), endDate, dimensions: ['page', 'query'] }, 50000);
      const mapped = rows.map((r) => ({ page: r.keys![0], query: r.keys![1], clicks: Math.round(r.clicks || 0), impressions: Math.round(r.impressions || 0), position: Number(r.position || 0), window_days: 28, fetched_at }));
      pq = await upsertChunks(db, 'gsc_page_query', mapped, 'page,query');
      await db.from('gsc_page_query').delete().lt('fetched_at', fetched_at);
    }

    await db.from('growth_settings').update({ gsc_sync_at: fetched_at, gsc_sync_error: null }).eq('id', 1);
    return `synced ${d} day(s), ${p} page-day(s), ${q} query-day(s), ${pq} page-query pair(s) over ${days}d`;
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 400);
    await db.from('growth_settings').update({ gsc_sync_at: new Date().toISOString(), gsc_sync_error: msg }).eq('id', 1);
    throw e;
  }
}
