-- Owner instant alerts + AI Design Scout + anonymous→known identity bridge.

-- Owner explicitly requested instant alerts, so this one defaults ON.
alter table growth_settings add column if not exists owner_alerts_enabled boolean not null default true;
alter table growth_settings add column if not exists design_scout_enabled boolean not null default false;

-- visitor_hash → email, captured the moment an anonymous visitor identifies
-- themselves (types an email at the cart / subscribes). Hashes rotate daily by
-- design (privacy), so each identified day adds one row.
create table if not exists visitor_identities (
  visitor_hash text primary key,
  email        text not null,
  created_at   timestamptz not null default now()
);
create index if not exists visitor_identities_email_idx on visitor_identities(email);
alter table visitor_identities enable row level security;
drop policy if exists "admin read visitor_identities" on visitor_identities;
create policy "admin read visitor_identities" on visitor_identities for select to authenticated using (is_admin());
