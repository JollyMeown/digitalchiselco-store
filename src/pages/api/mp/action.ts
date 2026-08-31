// One authenticated endpoint for every marketplace action, so buyer/maker
// token checks live in one place. POST { op, ... }.
//   maker (maker token): quote, message, progress
//   buyer (request token): award, message, complete, review
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyMakerToken, verifyRequestToken } from '../../../lib/marketplace-token';
import { notifyBuyerNewQuote, notifyMakerWon, SUCCESS_FEE_PCT } from '../../../lib/marketplace';

export const prerender = false;
const SITE = (import.meta.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const str = (v: unknown, n = 2000) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export const POST: APIRoute = async ({ request }) => {
  const b = await request.json().catch(() => ({}));
  const op = String(b.op || '');
  const db = supabaseAdmin();
  const maker = verifyMakerToken(b.token);
  const buyer = verifyRequestToken(b.token);
  if (!maker && !buyer) return json({ error: 'Session expired — please open your link again.' }, 401);

  // ── MAKER: submit a quote (spends 1 credit) ──
  if (op === 'quote') {
    if (!maker) return json({ error: 'Makers only.' }, 403);
    const { data: m } = await db.from('makers').select('*').eq('email', maker.email).eq('status', 'approved').maybeSingle();
    if (!m) return json({ error: 'Your maker account is not active.' }, 403);
    const price = Math.round(Number(b.price) * 100) / 100;
    if (!(price > 0)) return json({ error: 'Enter a price.' }, 400);
    const { data: req } = await db.from('maker_requests').select('*').eq('id', b.request_id).eq('status', 'open').maybeSingle();
    if (!req) return json({ error: 'This job is no longer open.' }, 400);
    const { data: existing } = await db.from('maker_quotes').select('id').eq('request_id', req.id).eq('maker_id', m.id).maybeSingle();
    if (!existing && (m.credits || 0) < 1) return json({ error: 'no_credits' }, 402);
    const q = { request_id: req.id, maker_id: m.id, price, lead_days: parseInt(b.lead_days, 10) || null, message: str(b.message, 1000) || null, status: 'submitted' };
    const { data: quote, error } = await db.from('maker_quotes').upsert(q, { onConflict: 'request_id,maker_id' }).select('*').single();
    if (error) return json({ error: error.message }, 500);
    if (!existing) {
      await db.from('makers').update({ credits: (m.credits || 0) - 1 }).eq('id', m.id);
      await db.from('maker_ledger').insert({ maker_id: m.id, kind: 'quote_spend', credits_delta: -1, request_id: req.id, note: 'quote submitted' });
      try { await notifyBuyerNewQuote(req, m, quote, `${SITE}/requests/${req.id}?buyer=1`); } catch {}
    }
    return json({ ok: true, credits: (m.credits || 0) - (existing ? 0 : 1) });
  }

  // ── BUYER: award a maker ──
  if (op === 'award') {
    if (!buyer) return json({ error: 'Buyers only.' }, 403);
    const { data: req } = await db.from('maker_requests').select('*').eq('id', buyer.id).eq('buyer_email', buyer.email).maybeSingle();
    if (!req || req.status !== 'open') return json({ error: 'This request is already decided.' }, 400);
    const { data: quote } = await db.from('maker_quotes').select('*').eq('id', b.quote_id).eq('request_id', req.id).maybeSingle();
    if (!quote) return json({ error: 'Quote not found.' }, 404);
    await db.from('maker_requests').update({ status: 'awarded', awarded_maker_id: quote.maker_id, awarded_at: new Date().toISOString(), agreed_price: quote.price }).eq('id', req.id);
    await db.from('maker_quotes').update({ status: 'won' }).eq('id', quote.id);
    await db.from('maker_quotes').update({ status: 'lost' }).eq('request_id', req.id).neq('id', quote.id);
    try { const { data: m } = await db.from('makers').select('*').eq('id', quote.maker_id).maybeSingle(); if (m) await notifyMakerWon(req, m); } catch {}
    return json({ ok: true });
  }

  // ── EITHER: send a chat message (thread = request + maker) ──
  if (op === 'message') {
    const request_id = str(b.request_id, 40);
    const maker_id = str(b.maker_id, 40);
    const body = str(b.body, 2000);
    const attachments = Array.isArray(b.attachments) ? b.attachments.filter((u: any) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 6) : [];
    if (!body && !attachments.length) return json({ error: 'Empty message.' }, 400);
    if (maker) {
      const { data: m } = await db.from('makers').select('id').eq('email', maker.email).maybeSingle();
      if (!m || m.id !== maker_id) return json({ error: 'Not your thread.' }, 403);
      await db.from('maker_messages').insert({ request_id, maker_id, sender: 'maker', body, attachments });
    } else {
      if (buyer!.id !== request_id) return json({ error: 'Not your request.' }, 403);
      await db.from('maker_messages').insert({ request_id, maker_id, sender: 'buyer', body, attachments });
    }
    return json({ ok: true });
  }

  // ── BUYER: mark completed (records the success fee owed) ──
  if (op === 'complete') {
    if (!buyer) return json({ error: 'Buyers only.' }, 403);
    const { data: req } = await db.from('maker_requests').select('*').eq('id', buyer.id).eq('buyer_email', buyer.email).maybeSingle();
    if (!req || req.status !== 'awarded') return json({ error: 'Nothing to complete.' }, 400);
    const fee = Math.round((Number(req.agreed_price || 0) * SUCCESS_FEE_PCT) / 100 * 100) / 100;
    await db.from('maker_requests').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', req.id);
    if (req.awarded_maker_id) {
      const { count } = await db.from('maker_requests').select('id', { count: 'exact', head: true }).eq('awarded_maker_id', req.awarded_maker_id).eq('status', 'completed');
      await db.from('makers').update({ jobs_completed: count || 1 }).eq('id', req.awarded_maker_id);
      await db.from('maker_ledger').insert({ maker_id: req.awarded_maker_id, kind: 'success_fee', amount_usd: fee, request_id: req.id, note: `${SUCCESS_FEE_PCT}% of $${req.agreed_price}` });
    }
    return json({ ok: true, fee });
  }

  // ── BUYER: leave a star rating ──
  if (op === 'review') {
    if (!buyer) return json({ error: 'Buyers only.' }, 403);
    const rating = Math.max(1, Math.min(5, parseInt(b.rating, 10) || 0));
    if (!rating) return json({ error: 'Pick 1–5 stars.' }, 400);
    const { data: req } = await db.from('maker_requests').select('*').eq('id', buyer.id).eq('buyer_email', buyer.email).maybeSingle();
    if (!req || !req.awarded_maker_id) return json({ error: 'Nothing to review yet.' }, 400);
    const { error } = await db.from('maker_reviews').upsert({ request_id: req.id, maker_id: req.awarded_maker_id, buyer_email: buyer.email, rating, comment: str(b.comment, 1000) || null }, { onConflict: 'request_id' });
    if (error) return json({ error: error.message }, 500);
    await db.rpc('recompute_maker_rating', { p_maker: req.awarded_maker_id });
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
};
