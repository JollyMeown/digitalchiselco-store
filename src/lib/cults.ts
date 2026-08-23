// Cults3D sales: fetch → persist → alert ONCE per sale.
//
// Three callers share this so detection is fast whichever one runs first:
//   • netlify/functions/cults-sales-poll.mjs  (scheduled, every 10 min)
//   • /api/admin/cults-sales                    (the Cults tab's 30 s refresh)
//   • scripts/cults_sales_poll.mjs              (optional local engine)
// Each sale is keyed by Cults' own id, so re-ingesting is idempotent, and the
// alert is claimed with an atomic `alerted_at is null` update, so two pollers
// racing can never double-ring or double-Telegram.
import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramOwner } from './notify';

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

export type CultsSale = {
  id: string;
  createdAt: string;
  payedOutAt: string | null;
  income: { value: number; currency: string; formatted?: string } | null;
  orderCountry: { name: string; code: string } | null;
  creation: { name: string; slug: string; url: string } | null;
};

export function cultsConfigured(): boolean {
  return !!(env('CULTS3D_USERNAME') && env('CULTS3D_API_KEY'));
}

// Browser-ish headers: Cults sits behind Cloudflare, which has blocked bare
// bot UAs from cloud IPs before. Retries once on 403/429/5xx.
export async function cultsGql<T = any>(query: string): Promise<T> {
  const auth = 'Basic ' + Buffer.from(`${env('CULTS3D_USERNAME')}:${env('CULTS3D_API_KEY')}`).toString('base64');
  let last: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch('https://cults3d.com/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: auth,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      body: JSON.stringify({ query }),
    });
    if (r.ok) {
      const d = await r.json();
      if (d.errors) throw new Error('Cults3D API error: ' + JSON.stringify(d.errors).slice(0, 300));
      return d.data as T;
    }
    last = new Error(`Cults3D HTTP ${r.status}`);
    if (![403, 429, 500, 502, 503, 504].includes(r.status)) break;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw last;
}

// Newest sales first. `limit` 100 is plenty for a 10-minute poll; pass a
// larger number (paginated) for a full backfill.
export async function fetchCultsSales(max = 100): Promise<CultsSale[]> {
  const out: CultsSale[] = [];
  for (let offset = 0; offset < max; offset += 100) {
    const d = await cultsGql<{ myself: { salesBatch: { total: number; results: CultsSale[] } } }>(`{ myself { salesBatch(limit:${Math.min(100, max - offset)}, offset:${offset}){ total results {
      id createdAt payedOutAt
      income { value currency formatted }
      orderCountry { name code }
      creation { name slug url(locale:EN) }
    } } } }`);
    const batch = d?.myself?.salesBatch?.results || [];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

const FLAG: Record<string, string> = {};
function flag(code?: string | null): string {
  if (!code || code.length !== 2) return '🌍';
  const c = code.toUpperCase();
  return FLAG[c] || (FLAG[c] = String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)));
}

export type IngestResult = { total: number; inserted: number; alerted: number; seeded: boolean; newSales: CultsSale[] };

// Persist sales and alert for the ones never seen before.
// First run on an empty table SEEDS silently (no 11-alert burst for history).
export async function ingestCultsSales(db: SupabaseClient, sales: CultsSale[], opts: { runner: string; alert?: boolean }): Promise<IngestResult> {
  const res: IngestResult = { total: sales.length, inserted: 0, alerted: 0, seeded: false, newSales: [] };
  if (!sales.length) return res;

  const { count } = await db.from('cults_sales').select('id', { count: 'exact', head: true });
  const seeding = (count || 0) === 0;
  res.seeded = seeding;

  const ids = sales.map((s) => s.id);
  const { data: known } = await db.from('cults_sales').select('id, payed_out_at').in('id', ids);
  const knownMap = new Map((known || []).map((k: any) => [k.id, k]));

  // Uniform keys per batch (PostgREST bulk upsert). alerted_at is only sent
  // when seeding (= now, silent); otherwise it's omitted so new rows default
  // to null (alert owed) and existing rows keep their value.
  const now = new Date().toISOString();
  const rows = sales.map((s) => ({
    id: s.id,
    sold_at: s.createdAt,
    product_name: s.creation?.name || null,
    slug: s.creation?.slug || null,
    url: s.creation?.url || null,
    country_name: s.orderCountry?.name || null,
    country_code: s.orderCountry?.code || null,
    income: Number(s.income?.value || 0),
    currency: s.income?.currency || 'EUR',
    payed_out_at: s.payedOutAt || null,
    raw: s,
    ...(seeding ? { alerted_at: now } : {}),
  }));
  // Upsert keeps payout status fresh for rows we already had.
  const { error } = await db.from('cults_sales').upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
  if (error) throw new Error('cults_sales upsert: ' + error.message);
  res.inserted = sales.filter((s) => !knownMap.has(s.id)).length;
  if (seeding || opts.alert === false) return res;

  // Atomic claim: only the caller whose update flips alerted_at gets to alert.
  const fresh = sales.filter((s) => !knownMap.has(s.id));
  if (!fresh.length) return res;
  const { data: claimed } = await db
    .from('cults_sales')
    .update({ alerted_at: new Date().toISOString() })
    .in('id', fresh.map((s) => s.id))
    .is('alerted_at', null)
    .select('id');
  const claimedIds = new Set((claimed || []).map((c: any) => c.id));
  const toAlert = fresh.filter((s) => claimedIds.has(s.id));
  if (!toAlert.length) return res;
  res.newSales = toAlert;

  // 1) Dashboard feed (rings the admin via realtime + polling fallback).
  const alertRows = toAlert.map((s) => ({
    kind: 'cults_sale',
    title: `Cults3D sale: ${s.income?.formatted || `€ ${Number(s.income?.value || 0).toFixed(2)}`}`,
    body: `${s.creation?.name || 'Unknown design'} · ${flag(s.orderCountry?.code)} ${s.orderCountry?.name || 'Unknown country'}`,
    amount: Number(s.income?.value || 0),
    currency: s.income?.currency || 'EUR',
    url: s.creation?.url || 'https://cults3d.com/en/sales',
    meta: { sale_id: s.id, slug: s.creation?.slug, country_code: s.orderCountry?.code, sold_at: s.createdAt, runner: opts.runner },
  }));
  const { error: aErr } = await db.from('owner_alerts').insert(alertRows);
  if (aErr) console.error('[cults] owner_alerts insert failed:', aErr.message);

  // 2) Telegram: one message per batch (no em dashes, per owner's style).
  const sum = toAlert.reduce((a, s) => a + Number(s.income?.value || 0), 0);
  const cur = toAlert[0]?.income?.currency || 'EUR';
  const sym = cur === 'EUR' ? '€' : cur === 'USD' ? '$' : cur + ' ';
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayRows } = await db.from('cults_sales').select('income').gte('sold_at', today + 'T00:00:00Z');
  const todayN = todayRows?.length || 0;
  const todayEur = (todayRows || []).reduce((a: number, r: any) => a + Number(r.income || 0), 0);
  const { data: pend } = await db.from('cults_sales').select('income').is('payed_out_at', null);
  const pending = (pend || []).reduce((a: number, r: any) => a + Number(r.income || 0), 0);
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = toAlert.map((s) => `• <a href="${esc(s.creation?.url || 'https://cults3d.com/en/sales')}">${esc(s.creation?.name || 'Unknown design')}</a> ${flag(s.orderCountry?.code)} ${esc(s.orderCountry?.name || '')} · <b>${esc(s.income?.formatted || sym + Number(s.income?.value || 0).toFixed(2))}</b>`);
  const head = toAlert.length === 1
    ? `💶 <b>Cults3D sale: ${esc(toAlert[0].income?.formatted || sym + sum.toFixed(2))}</b>`
    : `💶 <b>${toAlert.length} Cults3D sales: ${sym}${sum.toFixed(2)}</b>`;
  const text = `${head}\n${lines.join('\n')}\n\nToday: ${todayN} sale${todayN === 1 ? '' : 's'}, ${sym}${todayEur.toFixed(2)} · Pending payout: ${sym}${pending.toFixed(2)}`;
  const tg = await telegramOwner(text);
  res.alerted = toAlert.length;
  if (tg.skipped) console.warn('[cults] Telegram not configured; dashboard alert only');
  return res;
}

export async function markPoll(db: SupabaseClient, ok: boolean, note: string, runner: string) {
  try {
    await db.from('poll_status').upsert({ key: 'cults_sales', ran_at: new Date().toISOString(), ok, note: note.slice(0, 300), runner }, { onConflict: 'key' });
  } catch { /* best-effort */ }
}

// One call does everything. Never throws; returns what happened.
export async function pollCultsSales(db: SupabaseClient, runner: string, opts: { max?: number; alert?: boolean } = {}): Promise<IngestResult & { ok: boolean; error?: string }> {
  if (!cultsConfigured()) {
    await markPoll(db, false, 'CULTS3D_USERNAME / CULTS3D_API_KEY not set', runner);
    return { ok: false, error: 'not configured', total: 0, inserted: 0, alerted: 0, seeded: false, newSales: [] };
  }
  try {
    const sales = await fetchCultsSales(opts.max ?? 100);
    const r = await ingestCultsSales(db, sales, { runner, alert: opts.alert });
    await markPoll(db, true, `${r.total} checked · ${r.inserted} new · ${r.alerted} alerted${r.seeded ? ' · seeded history silently' : ''}`, runner);
    return { ok: true, ...r };
  } catch (e: any) {
    const msg = String(e?.message || e);
    await markPoll(db, false, msg, runner);
    return { ok: false, error: msg, total: 0, inserted: 0, alerted: 0, seeded: false, newSales: [] };
  }
}
