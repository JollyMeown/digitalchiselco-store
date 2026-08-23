// Admin: manual Cults3D sales poll, or a full-path TEST alert.
//   POST {}            → poll Cults now (persist + alert new sales once)
//   POST { test:true } → insert a test row into owner_alerts (rings the admin
//                        chime via realtime/polling) and send a Telegram test,
//                        so the owner can verify the whole path in one click.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { pollCultsSales } from '../../../lib/cults';
import { telegramOwner } from '../../../lib/notify';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

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
  const body = await request.json().catch(() => ({}));
  const db = supabaseAdmin();

  if (body?.test) {
    const { error } = await db.from('owner_alerts').insert({
      kind: 'cults_sale',
      title: 'TEST Cults3D sale: € 4.99',
      body: 'Test Design Relief STL · 🇺🇸 United States (this is only a test)',
      amount: 4.99, currency: 'EUR', url: 'https://cults3d.com/en/sales', meta: { test: true },
    });
    const tg = await telegramOwner('💶 <b>TEST Cults3D sale: € 4.99</b>\n• Test Design Relief STL 🇺🇸 United States\n\nThis is a test from the admin. Real sales will look like this.');
    return json({ ok: !error, feed: !error, telegram: tg.skipped ? 'not configured' : tg.ok ? 'sent' : 'failed', error: error?.message });
  }

  const r = await pollCultsSales(db, 'admin-manual');
  return json(r);
};
