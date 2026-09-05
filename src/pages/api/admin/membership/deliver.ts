// Admin actions on memberships. One route, an `action` field:
//   deliver   { subscription? }          send everything due now (one member, or all active)
//   resend    { subscription, month }    re-send one pack email
//   reminder  { subscription }           send the renewal reminder now
//   extend    { subscription, end_date } move the end date (and total drops to match)
//   note      { subscription, admin_notes, customer_name? }
//   test      { month }                  send that month's pack email to the shop inbox
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../../lib/supabase';
import { deliverNow, resendPack, sendReminderNow, getPack, addMonths, toYM, ymLabel, ymdLabel, packLink } from '../../../../lib/subscriptions';
import { monthlyDropEmail } from '../../../../lib/subscription-emails';
import { send as sendEmail } from '../../../../lib/resend';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const OPS_INBOX = 'jolly@digitalchiselco.com';
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
  const b = await request.json().catch(() => ({} as any));
  const action = String(b?.action || '');
  const sub = b?.subscription ? String(b.subscription) : '';
  const db = supabaseAdmin();
  try {
    if (action === 'deliver') {
      const stats = await deliverNow(sub || undefined);
      return json({ ok: true, stats, message: `${stats.processed} membership(s) checked: ${stats.drops} pack email(s) sent, ${stats.preExpiry} reminder(s), ${stats.skippedNoPack} waiting for a pack${stats.missingPacks.length ? ` (${stats.missingPacks.map(ymLabel).join(', ')})` : ''}, ${stats.failures} failed.` });
    }
    if (action === 'resend') {
      const r = await resendPack(sub, String(b?.month || ''));
      return r.ok ? json({ ok: true, message: 'Pack email re-sent.' }) : json({ error: r.error }, 400);
    }
    if (action === 'reminder') {
      const r = await sendReminderNow(sub);
      return r.ok ? json({ ok: true, message: 'Reminder sent.' }) : json({ error: r.error }, 400);
    }
    if (action === 'extend') {
      const end = String(b?.end_date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return json({ error: 'end_date must be YYYY-MM-DD' }, 400);
      const { data: s } = await db.from('member_subscriptions').select('start_date, drops_sent, status').eq('id', sub).maybeSingle();
      if (!s) return json({ error: 'not found' }, 404);
      // total drops = whole months between start and the new end
      let n = 0; while (addMonths(s.start_date, n + 1) <= end) n++;
      const total = Math.max(1, n);
      const next = s.drops_sent < total ? addMonths(s.start_date, s.drops_sent) : null;
      const patch: any = { end_date: end, total_drops: total, next_drop_date: next };
      if (s.status === 'expired' && end > new Date().toISOString().slice(0, 10)) patch.status = 'active';
      const { error } = await db.from('member_subscriptions').update(patch).eq('id', sub);
      return error ? json({ error: error.message }, 400) : json({ ok: true, message: `Term now ends ${ymdLabel(end)} with ${total} pack(s).` });
    }
    if (action === 'note') {
      const patch: any = {};
      if ('admin_notes' in b) patch.admin_notes = String(b.admin_notes || '').slice(0, 2000) || null;
      if ('customer_name' in b) patch.customer_name = String(b.customer_name || '').trim().slice(0, 120) || null;
      const { error } = await db.from('member_subscriptions').update(patch).eq('id', sub);
      return error ? json({ error: error.message }, 400) : json({ ok: true, message: 'Saved.' });
    }
    if (action === 'test') {
      const month = String(b?.month || '');
      const pack = await getPack(db, month);
      if (!pack) return json({ error: 'no pack for that month' }, 400);
      const fake = { id: '00000000-0000-0000-0000-000000000000', email: OPS_INBOX, customer_name: 'Jolly', tier: 'premium', total_drops: 3, start_date: month + '-01', end_date: addMonths(month + '-01', 3) };
      const { subject, html, text } = monthlyDropEmail({
        email: OPS_INBOX, customerName: 'Jolly', planName: 'Test of the pack email', monthLabel: ymLabel(month),
        packTitle: pack.title, previewNote: pack.preview_note, coverUrl: pack.cover_image_url, items: pack.items,
        standardLink: pack.standard_drive_link ? packLink(fake.id, month, 'standard', 'email') : null,
        bonusLink: pack.bonus_drive_link ? packLink(fake.id, month, 'bonus', 'email') : null,
        dropNumber: 1, totalDrops: 3, isPremium: true, nextPackLabel: ymLabel(toYM(addMonths(month + '-01', 1))), endDateLabel: ymdLabel(fake.end_date), logoUrl: null, makerInvite: true,
      });
      const r = await sendEmail({ to: OPS_INBOX, subject: `TEST: ${subject}`, html, text, tags: [{ name: 'kind', value: 'membership' }], idempotencyKey: `membership-test:${month}:${Date.now()}` });
      return r.ok ? json({ ok: true, message: `Test sent to ${OPS_INBOX}. Its download buttons open the pack but are not counted as member downloads.` }) : json({ error: r.error }, 500);
    }
    if (action === 'reconcile') {
      const { reconcileMembershipOrders } = await import('../../../../lib/subscriptions');
      const r = await reconcileMembershipOrders();
      return json({ ok: true, ...r, message: r.created.length ? `Created ${r.created.length} membership(s) from paid orders that had none: ${r.created.join('; ')}` : `Checked ${r.checked} membership order(s); every one already has its term.` });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message || e).slice(0, 400) }, 500);
  }
};
