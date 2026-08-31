// Public endpoint: a CNC/laser/3D-print maker applies to join the network.
// Stores a `pending` row (nothing is public until an admin approves). Portfolio
// images are uploaded separately via /api/maker-upload and passed here as URLs.
// Gated feature — the form that calls this is noindex and unlinked until launch.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

const strArr = (v: unknown, allow?: string[]): string[] => {
  if (!Array.isArray(v)) return [];
  const out = v.map((x) => String(x).slice(0, 60)).filter(Boolean);
  return (allow ? out.filter((x) => allow.includes(x)) : out).slice(0, 40);
};
const str = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const intOrNull = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!(await rateLimit(`maker-apply:ip:${ip}`, 5, 3600))) return tooMany('Too many submissions. Please try again later.');

  const b = await request.json().catch(() => ({}));
  if (b?.website2) return json({ ok: true }); // honeypot: pretend success, store nothing

  const email = str(b.email, 160).toLowerCase();
  const maker_name = str(b.maker_name, 120);
  const country = str(b.country, 80);
  const machine_types = strArr(b.machine_types, ['cnc_router', 'cnc_mill', 'laser', 'fdm', 'resin']);

  const errs: string[] = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.push('a valid email');
  if (!maker_name) errs.push('your maker / business name');
  if (!country) errs.push('your country');
  if (!machine_types.length) errs.push('at least one machine type');
  if (!(b.agreed_owns_machines && b.agreed_fees && b.agreed_terms)) errs.push('all three agreements checked');
  if (errs.length) return json({ error: 'Please add: ' + errs.join(', ') + '.' }, 400);

  const row = {
    status: 'pending',
    maker_name, email,
    contact_name: str(b.contact_name, 120) || null,
    phone: str(b.phone, 40) || null,
    country,
    city: str(b.city, 80) || null,
    region: str(b.region, 80) || null,
    postal: str(b.postal, 20) || null,
    deliver_radius_km: intOrNull(b.deliver_radius_km),
    deliver_domestic_ship: !!b.deliver_domestic_ship,
    deliver_intl: !!b.deliver_intl,
    deliver_intl_notes: str(b.deliver_intl_notes, 300) || null,
    machine_types,
    machine_count: intOrNull(b.machine_count),
    machine_models: str(b.machine_models, 500) || null,
    max_size: str(b.max_size, 120) || null,
    materials: strArr(b.materials),
    finishes: strArr(b.finishes),
    min_lead_days: intOrNull(b.min_lead_days),
    capacity_per_week: intOrNull(b.capacity_per_week),
    payment_methods: strArr(b.payment_methods, ['paypal', 'wise', 'venmo', 'bank', 'cash', 'other']),
    deposit_policy: str(b.deposit_policy, 300) || null,
    portfolio_urls: strArr(b.portfolio_urls).filter((u) => /^https?:\/\//.test(u)),
    etsy_url: str(b.etsy_url, 300) || null,
    website_url: str(b.website_url, 300) || null,
    instagram_url: str(b.instagram_url, 300) || null,
    years_experience: intOrNull(b.years_experience),
    bio: str(b.bio, 1500) || null,
    agreed_owns_machines: true, agreed_fees: true, agreed_terms: true,
    ip,
  };

  const db = supabaseAdmin();
  const { data, error } = await db.from('makers').insert(row).select('id').single();
  if (error) { console.error('[maker-apply]', error.message); return json({ error: 'Could not save your application. Please try again.' }, 500); }

  // mark the invite as applied (funnel tracking) — best-effort
  try { await db.from('maker_invites').upsert({ email, applied_at: new Date().toISOString() }, { onConflict: 'email' }); } catch {}
  // notify the owner a maker applied
  try {
    const { telegramOwner } = await import('../../lib/notify');
    await telegramOwner(`🛠️ <b>New maker application</b>\n${maker_name} · ${country}\n${machine_types.join(', ')} · ${email}\nReview in Admin → Makers.`);
  } catch {}

  return json({ ok: true, id: data.id });
};
