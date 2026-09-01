// Google Merchant Center daily performance (impressions / clicks / conversions).
//
// Auth: a Google Cloud SERVICE ACCOUNT that has been granted access to the
// Merchant Center account. We mint the OAuth token ourselves with node crypto
// (RS256 JWT bearer flow) rather than pulling in googleapis, which would add a
// large dependency to the SSR bundle for one call.
//
// Required env (Netlify):
//   GOOGLE_MERCHANT_ID              e.g. 5812545371
//   GOOGLE_SA_EMAIL                 the service account address
//   GOOGLE_SA_PRIVATE_KEY           its private key (\n escapes are handled)
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/content';
const env = (n: string) => process.env[n] ?? (import.meta as any).env?.[n];

export function merchantConfigured(): boolean {
  return !!(env('GOOGLE_MERCHANT_ID') && env('GOOGLE_SA_EMAIL') && env('GOOGLE_SA_PRIVATE_KEY'));
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

async function accessToken(): Promise<string> {
  const email = String(env('GOOGLE_SA_EMAIL'));
  // Netlify stores the key as a single line with literal \n sequences.
  const key = String(env('GOOGLE_SA_PRIVATE_KEY')).replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const signature = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`token: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}

export type MerchantDay = { day: string; impressions: number; clicks: number; ctr: number; conversions: number; conversion_value: number };

// Pulls per-day totals for the last `days` days from the Merchant API's
// product performance report.
export async function fetchMerchantDaily(days = 30): Promise<MerchantDay[]> {
  if (!merchantConfigured()) throw new Error('Google Merchant service account not configured');
  const account = String(env('GOOGLE_MERCHANT_ID')).replace(/\D/g, '');
  const token = await accessToken();
  const end = new Date();
  const start = new Date(Date.now() - days * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const query = `SELECT date, impressions, clicks, clickThroughRate, conversions, conversionValue
                 FROM ProductPerformanceView
                 WHERE date BETWEEN '${iso(start)}' AND '${iso(end)}'`;

  const out: MerchantDay[] = [];
  let pageToken: string | undefined;
  do {
    // v1beta was discontinued 2026-02-28; v1 is the live version.
    const res = await fetch(`https://merchantapi.googleapis.com/reports/v1/accounts/${account}/reports:search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`reports: ${res.status} ${text.slice(0, 300)}`);
    const j = JSON.parse(text || '{}');
    for (const row of j.results || []) {
      const p = row.productPerformanceView || row;
      // The API returns date either as a string or {year,month,day}.
      const d = typeof p.date === 'string'
        ? p.date
        : p.date ? `${p.date.year}-${String(p.date.month).padStart(2, '0')}-${String(p.date.day).padStart(2, '0')}` : '';
      if (!d) continue;
      out.push({
        day: d,
        impressions: Number(p.impressions || 0),
        clicks: Number(p.clicks || 0),
        ctr: Number(p.clickThroughRate || 0),
        conversions: Number(p.conversions || 0),
        conversion_value: Number(p.conversionValue || 0),
      });
    }
    pageToken = j.nextPageToken;
  } while (pageToken);

  // Same day can appear more than once when the report is segmented; fold them.
  const byDay = new Map<string, MerchantDay>();
  for (const r of out) {
    const cur = byDay.get(r.day);
    if (!cur) byDay.set(r.day, { ...r });
    else {
      cur.impressions += r.impressions; cur.clicks += r.clicks;
      cur.conversions += r.conversions; cur.conversion_value += r.conversion_value;
      cur.ctr = cur.impressions ? cur.clicks / cur.impressions : 0;
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// Fetch + upsert into merchant_stats_daily. Returns a short status string.
export async function syncMerchantStats(days = 30): Promise<string> {
  const { supabaseAdmin } = await import('./supabase');
  const db = supabaseAdmin();
  try {
    const rows = await fetchMerchantDaily(days);
    if (rows.length) {
      const { error } = await db.from('merchant_stats_daily')
        .upsert(rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })), { onConflict: 'day' });
      if (error) throw new Error(error.message);
    }
    await db.from('growth_settings').update({ merchant_sync_at: new Date().toISOString(), merchant_sync_error: null }).eq('id', 1);
    return `synced ${rows.length} day(s)`;
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    await db.from('growth_settings').update({ merchant_sync_at: new Date().toISOString(), merchant_sync_error: msg }).eq('id', 1);
    throw e;
  }
}
