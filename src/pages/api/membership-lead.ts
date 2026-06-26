import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;

// POST { name, email, plan_slug } -> { ok: true }
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').toLowerCase().trim();
    const plan_slug = String(body.plan_slug || '').trim().slice(0, 40);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    const db = supabaseAdmin();
    const { error } = await db
      .from('membership_leads')
      .insert({ name: name || null, email, plan_slug: plan_slug || null, source: 'membership-page' });
    if (error) throw error;
    // also add to subscribers so they get the regular newsletter flow
    await db.from('subscribers').upsert({ email, source: 'membership' }, { onConflict: 'email' });
    return json({ ok: true });
  } catch (e) {
    console.error('membership-lead failed:', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
