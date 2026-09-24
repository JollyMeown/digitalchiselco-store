import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;

// POST { name, email, plan_slug } -> { ok: true }
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').toLowerCase().trim();
    const plan_slug = String(body.plan_slug || '').trim().slice(0, 40);
    if (name.length < 2) {
      return json({ error: 'Please enter your name.' }, 400);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }
    const ip = clientIp(request);
    if (!(await rateLimit(`memberlead:ip:${ip}`, 10, 3600)) ||
        !(await rateLimit(`memberlead:email:${email}`, 5, 3600))) {
      return tooMany();
    }
    const db = supabaseAdmin();
    const { error } = await db
      .from('membership_leads')
      .insert({ name, email, plan_slug: plan_slug || null, source: 'membership-page' });
    if (error) throw error;
    await db.from('subscribers').upsert({ email, source: 'membership' }, { onConflict: 'email' });

    // (Used to also add the lead to a MailerLite group; MailerLite was
    // cancelled 2026-09-24. The lead lives in membership_leads + subscribers.)

    return json({ ok: true });
  } catch (e) {
    console.error('membership-lead failed:', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
