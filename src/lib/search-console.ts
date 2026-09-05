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

async function accessToken(scope: string = SCOPE): Promise<string> {
  const email = String(env('GOOGLE_SA_EMAIL'));
  const key = String(env('GOOGLE_SA_PRIVATE_KEY')).replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
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

// ── Ownership by DNS, the way around Search Console's "email not found" ──
// Since late April 2026 Search Console's Add-user dialog rejects service
// accounts ("Failed to add user: email not found", a Google-side bug with no
// fix date). The Site Verification API sidesteps the dialog entirely: the
// service account asks Google for a DNS TXT token for the domain, the owner
// adds that record at the DNS host, the service account then verifies and
// becomes a verified OWNER of the domain property, which is all the access
// the sync needs. Needs "Site Verification API" enabled in the SA's project.
const VERIFY_SCOPE = 'https://www.googleapis.com/auth/siteverification';
const VERIFY_API = 'https://www.googleapis.com/siteVerification/v1';
export function gscDomain(): string {
  return gscSite().replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export async function gscVerificationToken(): Promise<string> {
  const token = await accessToken(VERIFY_SCOPE);
  const res = await fetch(`${VERIFY_API}/token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ site: { type: 'INET_DOMAIN', identifier: gscDomain() }, verificationMethod: 'DNS_TXT' }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`siteVerification token: ${res.status} ${text.slice(0, 400)}`);
  const j = JSON.parse(text || '{}');
  if (!j.token) throw new Error('no token in response: ' + text.slice(0, 200));
  return String(j.token);
}

export async function gscVerifyDomain(): Promise<string> {
  const token = await accessToken(VERIFY_SCOPE);
  const res = await fetch(`${VERIFY_API}/webResource?verificationMethod=DNS_TXT`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ site: { type: 'INET_DOMAIN', identifier: gscDomain() } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`siteVerification verify: ${res.status} ${text.slice(0, 400)}`);
  const j = JSON.parse(text || '{}');
  return `verified: ${j.site?.identifier || gscDomain()} is now owned by ${gscServiceAccountEmail()} (owners: ${(j.owners || []).length})`;
}

// A verified owner still has to ADD the property to its own Search Console
// list before searchAnalytics answers ("User does not have sufficient
// permission for site"). A person gets that for free in the UI; a service
// account has to call sites.add, which needs the full (not readonly) scope.
const FULL_SCOPE = 'https://www.googleapis.com/auth/webmasters';
export async function gscAddSite(): Promise<string> {
  const token = await accessToken(FULL_SCOPE);
  const site = encodeURIComponent(gscSite());
  const res = await fetch(`${API}/sites/${site}`, { method: 'PUT', headers: { authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`sites.add: ${res.status} ${text.slice(0, 400)}`);
  }
  const list = await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${token}` } });
  const j = await list.json().catch(() => ({}));
  const mine = (j.siteEntry || []).map((s: any) => `${s.siteUrl} (${s.permissionLevel})`);
  return `property added; the account now sees: ${mine.join(', ') || 'nothing yet'}`;
}

// ── Index coverage, URL by URL ────────────────────────────────────────
// Search Console's Pages report ("1,231 not indexed") has no API, but the URL
// Inspection API returns the same verdict per URL, 2,000 a day. The nightly
// run inspects the sitemap URLs least recently looked at; the admin button
// runs a bigger slice in a background function.
export type UrlStatus = {
  url: string; verdict: string | null; coverage_state: string | null; indexing_state: string | null;
  robots_txt_state: string | null; page_fetch_state: string | null; google_canonical: string | null;
  user_canonical: string | null; last_crawl: string | null; crawled_as: string | null; rich_results: string | null; inspected_at: string;
};

export async function gscInspectUrl(url: string, token?: string): Promise<UrlStatus> {
  const t = token || await accessToken(FULL_SCOPE);
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: url, siteUrl: gscSite(), languageCode: 'en-US' }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`inspect ${res.status}: ${text.slice(0, 300)}`);
  const r = JSON.parse(text || '{}').inspectionResult || {};
  const idx = r.indexStatusResult || {};
  return {
    url, verdict: idx.verdict || null, coverage_state: idx.coverageState || null, indexing_state: idx.indexingState || null,
    robots_txt_state: idx.robotsTxtState || null, page_fetch_state: idx.pageFetchState || null,
    google_canonical: idx.googleCanonical || null, user_canonical: idx.userCanonical || null,
    last_crawl: idx.lastCrawlTime || null, crawled_as: idx.crawledAs || null,
    rich_results: r.richResultsResult?.verdict || null, inspected_at: new Date().toISOString(),
  };
}

async function sitemapUrls(): Promise<string[]> {
  const site = `https://${gscDomain()}`;
  const res = await fetch(`${site}/sitemap.xml`, { headers: { 'user-agent': 'dcc-index-audit' } });
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

// Inspect up to `max` sitemap URLs, oldest-inspected first (never-inspected
// before that), within a time budget. Returns a status string for the ledger.
export async function gscInspectSlice(max = 250, opts: { budgetMs?: number } = {}): Promise<string> {
  const { supabaseAdmin } = await import('./supabase');
  const db = supabaseAdmin();
  const started = Date.now();
  const budget = opts.budgetMs ?? 12 * 60 * 1000;
  const urls = await sitemapUrls();
  if (!urls.length) return 'sitemap empty';
  // everything we already know, so the queue is "never inspected" then "oldest"
  const known = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('gsc_url_status').select('url, inspected_at').range(from, from + 999);
    for (const r of data || []) known.set(r.url, r.inspected_at);
    if (!data || data.length < 1000) break;
  }
  const queue = urls
    .map((u) => ({ u, at: known.get(u) || '' }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, max)
    .map((x) => x.u);
  const token = await accessToken(FULL_SCOPE);
  let done = 0, failed = 0; const counts: Record<string, number> = {};
  for (const url of queue) {
    if (Date.now() - started > budget) break;
    try {
      const s = await gscInspectUrl(url, token);
      const { error } = await db.from('gsc_url_status').upsert(s, { onConflict: 'url' });
      if (error) throw new Error(error.message);
      counts[s.coverage_state || '?'] = (counts[s.coverage_state || '?'] || 0) + 1;
      done++;
    } catch (e: any) {
      failed++;
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(String(e?.message))) { return `quota reached after ${done} (${JSON.stringify(counts)})`; }
      if (failed > 20) return `stopped: too many failures (${done} ok): ${String(e?.message).slice(0, 200)}`;
    }
  }
  return `inspected ${done} of ${urls.length} sitemap URLs (${known.size + done} known), ${failed} failed: ${JSON.stringify(counts)}`;
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

    // 1) totals per day: one request, always completes. On the first run
    // after DNS verification the property is not in the account's list yet;
    // add it and try once more before giving up.
    let daily: SaRow[];
    try {
      daily = await query(token, { startDate, endDate, dimensions: ['date'] });
    } catch (e: any) {
      if (!/sufficient permission/i.test(String(e?.message))) throw e;
      await gscAddSite();
      daily = await query(token, { startDate, endDate, dimensions: ['date'] });
    }
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
