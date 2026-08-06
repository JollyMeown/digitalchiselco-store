// One-click unsubscribe for marketing emails (drip / followups / reminders).
// Link format: /api/unsubscribe?e=<email>&s=<hmac>  — the hmac stops anyone
// unsubscribing other people. Marks subscribers.unsubscribed_at + stops drip.

import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { unsubSig } from '../../lib/marketing-emails';

export const prerender = false;

const page = (msg: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>DigitalChiselCo</title>
  <body style="font-family:Helvetica,Arial,sans-serif;background:#F5EFE3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="background:#fff;border:1px solid #E5DDD0;border-radius:12px;padding:36px;max-width:420px;text-align:center">
  <h2 style="color:#5E380A;font-family:Georgia,serif;margin:0 0 10px">${msg}</h2>
  <p style="color:#666;font-size:14px">Order and download emails are unaffected.</p>
  <a href="https://digitalchiselco.com" style="color:#854F0B">digitalchiselco.com</a></div>`,
  { headers: { 'content-type': 'text/html; charset=utf-8' } });

export const GET: APIRoute = async ({ url }) => {
  const email = (url.searchParams.get('e') || '').toLowerCase().trim();
  const sig = url.searchParams.get('s') || '';
  if (!email || sig !== unsubSig(email)) return page('That link is not valid.');
  const db = supabaseAdmin();
  await db.from('subscribers').update({ unsubscribed_at: new Date().toISOString() }).ilike('email', email);
  await db.from('subscriber_drip').update({ status: 'stopped' }).ilike('email', email);
  return page("You're unsubscribed from marketing emails.");
};
