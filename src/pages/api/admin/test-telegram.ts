// Admin "Send test Telegram" — confirms TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
// are set correctly by pushing one message to the owner's Telegram. Admin-gated.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { telegramOwner } from '../../../lib/notify';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  const { data: prof } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const r = await telegramOwner('✅ <b>DigitalChiselCo test alert</b>\nYour Telegram alerts are working. You will get a ping here for every new order and big cart. 🎉');
  if (r.skipped) return json({ ok: false, skipped: true, error: 'Telegram is not configured yet — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Netlify, then redeploy.' });
  if (!r.ok) return json({ ok: false, error: 'Telegram rejected the message. Double-check the token and chat ID, and make sure you have messaged your bot at least once.' });
  return json({ ok: true, message: 'Sent! Check your Telegram — the test message should be there.' });
};
