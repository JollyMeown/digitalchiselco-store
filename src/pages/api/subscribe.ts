import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    const db = supabaseAdmin();
    const { error } = await db
      .from('subscribers')
      .upsert({ email, source: 'free-pack' }, { onConflict: 'email' });
    if (error) throw error;
    return json({ ok: true });
  } catch (e) {
    console.error('subscribe failed:', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
