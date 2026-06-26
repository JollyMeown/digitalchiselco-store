import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { subscribe as mailerliteSubscribe } from '../../lib/mailerlite';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    const name = String(body.name || '').trim().slice(0, 120) || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    const db = supabaseAdmin();
    const { error } = await db
      .from('subscribers')
      .upsert({ email, source: 'free-pack' }, { onConflict: 'email' });
    if (error) throw error;

    // Hand off to MailerLite so they get the double-opt-in email and the
    // free-pack automation fires. No-op if MAILERLITE_API_KEY is unset.
    await mailerliteSubscribe({ email, name, groupKey: 'free' });

    return json({ ok: true });
  } catch (e) {
    console.error('subscribe failed:', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
