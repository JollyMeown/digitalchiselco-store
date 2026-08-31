-- 069: Maker network — applications + profiles (Phase 1 of the marketplace).
-- Separate from `subscribers`: a maker is a vetted fabricator, not a mailing
-- contact. Nothing here is public until an admin approves it, and the whole
-- feature stays unlinked/noindex until launch.
create table if not exists public.makers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending',          -- pending | approved | rejected | suspended
  -- identity
  maker_name text not null,
  contact_name text,
  email text not null,
  phone text,
  -- location + delivery reach
  country text not null,
  city text,
  region text,
  postal text,
  deliver_radius_km integer,                        -- how far they deliver within their country
  deliver_domestic_ship boolean not null default false,
  deliver_intl boolean not null default false,
  deliver_intl_notes text,                          -- which regions / how they ship abroad
  -- capabilities
  machine_types text[] not null default '{}',       -- cnc_router | cnc_mill | laser | fdm | resin
  machine_count integer,
  machine_models text,                              -- "ShopBot PRSalpha 96x48, Onefinity Journeyman"
  max_size text,                                    -- largest piece they can make
  materials text[] not null default '{}',           -- walnut, oak, mdf, acrylic, aluminum ...
  finishes text[] not null default '{}',            -- sanded, oiled, stained, painted, epoxy ...
  -- operations
  min_lead_days integer,
  capacity_per_week integer,
  payment_methods text[] not null default '{}',     -- paypal | wise | venmo | bank | cash
  deposit_policy text,
  -- trust / portfolio
  portfolio_urls text[] not null default '{}',
  etsy_url text, website_url text, instagram_url text,
  years_experience integer,
  bio text,
  -- explicit agreements (all required to submit)
  agreed_owns_machines boolean not null default false,
  agreed_fees boolean not null default false,
  agreed_terms boolean not null default false,
  -- admin
  admin_note text,
  reviewed_at timestamptz,
  ip text
);
create index if not exists makers_status_idx on public.makers (status, created_at desc);
create index if not exists makers_email_idx on public.makers (lower(email));

-- RLS: only admins can read; all writes come from service_role (the apply API
-- and the admin). No anon/public read of applications.
alter table public.makers enable row level security;
drop policy if exists makers_admin_read on public.makers;
drop policy if exists makers_admin_write on public.makers;
create policy makers_admin_read  on public.makers for select to authenticated using (public.is_admin());
create policy makers_admin_write on public.makers for all    to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.makers from anon;

-- Who has been invited to become a maker (so the recruit email is idempotent
-- and we can measure the funnel: invited -> applied -> approved).
create table if not exists public.maker_invites (
  email text primary key,
  invited_at timestamptz not null default now(),
  applied_at timestamptz,
  source text
);
alter table public.maker_invites enable row level security;
drop policy if exists maker_invites_admin on public.maker_invites;
create policy maker_invites_admin on public.maker_invites for select to authenticated using (public.is_admin());
revoke all on public.maker_invites from anon;
