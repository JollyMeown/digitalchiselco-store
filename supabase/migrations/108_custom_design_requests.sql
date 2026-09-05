-- Custom design service (owner 2026-09-06): Etsy shoppers keep asking for
-- copies of other shops' designs; we say no, but they are customers, so we
-- pitch an ORIGINAL custom design from their own photo, from $30. This adds:
--   * custom_design_requests: the /custom-design form inbox (photo + brief)
--   * custom_pitch_log: who has had the pitch email (never twice)
--   * growth_settings.custom_pitch_enabled: nightly drip to source='custom-ask'
create table if not exists public.custom_design_requests (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  photo_url text,
  description text,
  size_note text,
  material text,
  deadline text,
  status text not null default 'new',          -- new | quoted | paid | in_progress | delivered | declined
  quote_usd numeric(10,2),
  admin_notes text,
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists custom_design_requests_status_idx on public.custom_design_requests (status, created_at desc);
alter table public.custom_design_requests enable row level security;
drop policy if exists "custom_design_requests_admin_all" on public.custom_design_requests;
create policy "custom_design_requests_admin_all" on public.custom_design_requests
  for all using (is_admin()) with check (is_admin());
-- no public policy: submissions go through the service role, requesters get email

create table if not exists public.custom_pitch_log (
  email text primary key,
  sent_at timestamptz not null default now(),
  note text,
  source text,                                  -- 'admin' (sent by hand) | 'drip' (nightly)
  provider_id text
);
alter table public.custom_pitch_log enable row level security;
drop policy if exists "custom_pitch_log_admin_all" on public.custom_pitch_log;
create policy "custom_pitch_log_admin_all" on public.custom_pitch_log
  for all using (is_admin()) with check (is_admin());

alter table public.growth_settings add column if not exists custom_pitch_enabled boolean not null default false;
