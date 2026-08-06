-- Growth pack: funnel events, search log, abandoned carts, subscriber drip,
-- post-purchase followups, and the review-first automation toggles.

-- ── funnel + search events (same beacon as site_visits, richer types) ──
create table if not exists site_events (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  day          date not null default current_date,
  type         text not null,            -- 'view_product' | 'add_to_cart' | 'checkout_start' | 'search'
  path         text,
  product_id   uuid,
  q            text,                     -- search term (type='search')
  n            int,                      -- search result count
  visitor_hash text
);
create index if not exists site_events_day_type_idx on site_events(day, type);

-- ── abandoned carts (email captured at checkout, never paid) ──────────
create table if not exists abandoned_carts (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  cart         jsonb not null default '[]'::jsonb,   -- [{id,title,price,qty}]
  subtotal     numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  reminded_at  timestamptz,
  recovered_at timestamptz
);
create unique index if not exists abandoned_carts_email_open_idx
  on abandoned_carts(lower(email)) where recovered_at is null;

-- ── subscriber nurture drip state ─────────────────────────────────────
create table if not exists subscriber_drip (
  email        text primary key,
  stage        int not null default 0,        -- stages sent so far (0..5)
  last_sent_at timestamptz,
  status       text not null default 'active', -- active | done | converted | stopped
  enrolled_at  timestamptz not null default now()
);

-- ── post-purchase followups (idempotency ledger) ──────────────────────
create table if not exists order_followups (
  order_id uuid not null references orders(id) on delete cascade,
  kind     text not null,                -- 'review7' | 'arrivals30' | 'loyalty'
  sent_at  timestamptz not null default now(),
  primary key (order_id, kind)
);

-- ── automation toggles: EVERYTHING OFF until the owner reviews ────────
create table if not exists growth_settings (
  id                     int primary key default 1,
  drip_enabled           boolean not null default false,
  cart_reminders_enabled boolean not null default false,
  followups_enabled      boolean not null default false,
  updated_at             timestamptz not null default now()
);
insert into growth_settings (id) values (1) on conflict (id) do nothing;

alter table subscribers add column if not exists unsubscribed_at timestamptz;

-- ── RLS ───────────────────────────────────────────────────────────────
alter table site_events      enable row level security;
alter table abandoned_carts  enable row level security;
alter table subscriber_drip  enable row level security;
alter table order_followups  enable row level security;
alter table growth_settings  enable row level security;
drop policy if exists "admin read site_events" on site_events;
create policy "admin read site_events" on site_events for select to authenticated using (is_admin());
drop policy if exists "admin all abandoned_carts" on abandoned_carts;
create policy "admin all abandoned_carts" on abandoned_carts for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin all subscriber_drip" on subscriber_drip;
create policy "admin all subscriber_drip" on subscriber_drip for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin read order_followups" on order_followups;
create policy "admin read order_followups" on order_followups for select to authenticated using (is_admin());
drop policy if exists "admin all growth_settings" on growth_settings;
create policy "admin all growth_settings" on growth_settings for all to authenticated using (is_admin()) with check (is_admin());

-- ── standing coupons for the upsell mechanics ─────────────────────────
-- SET10: the "complete the set" / threshold discount — 10% off with 2+ items.
insert into coupons (code, percent_off, min_items, active)
select 'SET10', 10, 2, true
where not exists (select 1 from coupons where lower(code) = 'set10');
-- THANKYOU10: shown on the order-success page for the NEXT order.
insert into coupons (code, percent_off, active)
select 'THANKYOU10', 10, true
where not exists (select 1 from coupons where lower(code) = 'thankyou10');
