// Admin: the custom-design pitch. Actions (POST, admin bearer):
//   list                       -> pitch ledger + custom requests + this week's design count
//   preview {email?, name?, note?}   -> {subject, html}
//   test {note?}               -> sends the pitch to the admin's own address
//   send {rows:[{email,name?}], note?, dry?} -> sends now to each address not in the ledger
//   queue {rows:[{email,name?}]}     -> adds to subscribers (source custom-ask) so the nightly drip sends
//   request_update {id, status?, quote_usd?, admin_notes?}
// Every send is logged in custom_pitch_log (email PK) so nobody gets it twice,
// whichever route sent it.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail } from '../../../lib/resend';
import { thisWeeksDesigns, renderPitch } from '../../../lib/custom-pitch';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function callerAdmin(request: Request): Promise<{ ok: boolean; email?: string }> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { ok: false };
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return { ok: false };
  const { data: prof } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return { ok: !!prof?.is_admin, email: who.user.email || undefined };
}

type Row = { email: string; name?: string | null };
function parseRows(input: unknown): Row[] {
  const rows: Row[] = [];
  for (const r of Array.isArray(input) ? input : []) {
    const email = String(r?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    rows.push({ email, name: r?.name ? String(r.name).trim().slice(0, 80) : null });
  }
  return [...new Map(rows.map((r) => [r.email, r])).values()].slice(0, 200);
}

export const POST: APIRoute = async ({ request }) => {
  const who = await callerAdmin(request);
  if (!who.ok) return json({ error: 'Admin authentication required.' }, 401);
  const b = await request.json().catch(() => ({} as any));
  const action = String(b.action || 'list');
  const db = supabaseAdmin();
  try {
    if (action === 'list') {
      const [{ data: log }, { data: reqs }, { data: queued }, week] = await Promise.all([
        db.from('custom_pitch_log').select('*').order('sent_at', { ascending: false }).limit(200),
        db.from('custom_design_requests').select('*').order('created_at', { ascending: false }).limit(100),
        db.from('subscribers').select('email').eq('source', 'custom-ask').is('unsubscribed_at', null),
        thisWeeksDesigns(db),
      ]);
      const sent = new Set((log || []).map((l: any) => l.email));
      const waiting = (queued || []).filter((s: any) => !sent.has(String(s.email).toLowerCase())).length;
      return json({ ok: true, log: log || [], requests: reqs || [], waiting, weekDesigns: week.total });
    }
    if (action === 'preview') {
      const out = await renderPitch(db, String(b.email || 'preview@example.com'), b.name || null, b.note || null);
      return json({ ok: true, subject: out.subject, html: out.html });
    }
    if (action === 'test') {
      if (!who.email) return json({ error: 'no admin email' }, 400);
      const out = await renderPitch(db, who.email, b.name || 'Sample Carver', b.note || null);
      const r = await sendEmail({ to: who.email, subject: `[TEST] ${out.subject}`, html: out.html, text: out.text, tags: [{ name: 'kind', value: 'custom-pitch-test' }] });
      return r.ok ? json({ ok: true, message: `Test sent to ${who.email}` }) : json({ error: r.error || 'send failed' }, 502);
    }
    if (action === 'send' || action === 'queue') {
      const rows = parseRows(b.rows);
      if (!rows.length) return json({ error: 'No valid email addresses.' }, 400);
      const note = b.note ? String(b.note).trim().slice(0, 600) : null;
      const { data: done } = await db.from('custom_pitch_log').select('email').in('email', rows.map((r) => r.email));
      const already = new Set((done || []).map((d: any) => d.email));
      const { data: unsub } = await db.from('subscribers').select('email').in('email', rows.map((r) => r.email)).not('unsubscribed_at', 'is', null);
      const blocked = new Set((unsub || []).map((d: any) => String(d.email).toLowerCase()));
      const out: { email: string; result: string }[] = [];
      let sent = 0, skipped = 0, failed = 0;
      const now = new Date().toISOString();
      for (const r of rows) {
        if (already.has(r.email)) { skipped++; out.push({ email: r.email, result: 'already had the pitch' }); continue; }
        if (blocked.has(r.email)) { skipped++; out.push({ email: r.email, result: 'unsubscribed, not sent' }); continue; }
        // make sure they are a (confirmed) subscriber so the weekly digest follows
        await db.from('subscribers').upsert({ email: r.email, source: 'custom-ask', confirmed_at: now, name: r.name || null } as any, { onConflict: 'email', ignoreDuplicates: true });
        if (action === 'queue') { out.push({ email: r.email, result: 'queued for the nightly drip' }); sent++; continue; }
        if (b.dry) { out.push({ email: r.email, result: 'would send' }); sent++; continue; }
        const mail = await renderPitch(db, r.email, r.name, note);
        const res = await sendEmail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text, tags: [{ name: 'kind', value: 'custom-pitch' }], idempotencyKey: `custom-pitch:${r.email}` });
        if (res.ok) {
          sent++;
          await db.from('custom_pitch_log').upsert({ email: r.email, sent_at: now, note, source: 'admin', provider_id: (res as any).id || null }, { onConflict: 'email' });
          out.push({ email: r.email, result: 'sent' });
        } else { failed++; out.push({ email: r.email, result: 'failed: ' + (res.error || 'unknown') }); }
      }
      return json({ ok: true, sent, skipped, failed, rows: out, message: action === 'queue' ? `${sent} queued, ${skipped} skipped` : `${sent} sent, ${skipped} skipped, ${failed} failed` });
    }
    if (action === 'request_update') {
      const id = String(b.id || '');
      if (!id) return json({ error: 'id required' }, 400);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.status) patch.status = String(b.status).slice(0, 20);
      if (b.quote_usd !== undefined) patch.quote_usd = b.quote_usd === '' || b.quote_usd === null ? null : Number(b.quote_usd);
      if (b.admin_notes !== undefined) patch.admin_notes = String(b.admin_notes || '').slice(0, 2000) || null;
      const { error } = await db.from('custom_design_requests').update(patch).eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, message: 'Saved.' });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e: any) { return json({ error: e?.message || 'failed' }, 500); }
};
