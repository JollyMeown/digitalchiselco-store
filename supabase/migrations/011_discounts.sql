-- Two complementary discount systems:
--   A) Promo codes (extend `coupons`) — customer enters a code at checkout
--   B) Sales (new `sales` table)      — time-bounded, auto-applied, no code

-- ─── A) Promo codes ────────────────────────────────────────────────────────
alter table coupons add column if not exists fixed_amount_off numeric(10,2);
alter table coupons add column if not exists min_items int;            -- e.g. require 6 items in cart
alter table coupons add column if not exists min_subtotal numeric(10,2); -- e.g. require subtotal >= 50
alter table coupons add column if not exists max_redemptions int;      -- total times this code can be used (null = unlimited)
alter table coupons add column if not exists redemption_count int default 0;
alter table coupons add column if not exists single_use_per_buyer boolean default false;
alter table coupons add column if not exists starts_at timestamptz;
alter table coupons add column if not exists description text;         -- internal note (e.g. "bulk 6+")
alter table coupons add column if not exists scope text default 'all'; -- 'all' | 'category' | 'product'
alter table coupons add column if not exists scope_ids uuid[];         -- ids of categories/products if scoped
create index if not exists coupons_active_idx on coupons(active);
create index if not exists coupons_code_idx on coupons(lower(code));

-- Track which orders used which coupons (for single_use_per_buyer enforcement
-- and redemption analytics).
create table if not exists coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references coupons(id) on delete cascade,
  order_id    uuid references orders(id) on delete set null,
  email       text,
  amount_off  numeric(10,2),
  created_at  timestamptz default now()
);
create index if not exists coupon_redemptions_coupon_idx on coupon_redemptions(coupon_id);
create index if not exists coupon_redemptions_email_idx on coupon_redemptions(email);
alter table coupon_redemptions enable row level security;
drop policy if exists "admin read coupon_redemptions" on coupon_redemptions;
create policy "admin read coupon_redemptions" on coupon_redemptions for select to authenticated using (is_admin());

-- Orders: record which coupon was applied + how much was knocked off
alter table orders add column if not exists coupon_id uuid references coupons(id) on delete set null;
alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists discount_amount numeric(10,2) default 0;

-- ─── B) Sales ──────────────────────────────────────────────────────────────
create table if not exists sales (
  id              uuid primary key default gen_random_uuid(),
  name            text unique not null,                    -- Etsy-style internal name, e.g. "SUMMERSALE2026"
  percent_off     int check (percent_off between 1 and 100),
  starts_at       timestamptz not null,
  expires_at      timestamptz not null,
  active          boolean default true,
  scope           text default 'all',                      -- 'all' | 'category' | 'product'
  scope_ids       uuid[],
  terms           text,                                    -- shown to buyer on eligible listings
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists sales_active_window_idx on sales(active, starts_at, expires_at);
alter table sales enable row level security;
drop policy if exists "public read active sales" on sales;
create policy "public read active sales" on sales for select using (active = true and now() between starts_at and expires_at);
drop policy if exists "admin all sales" on sales;
create policy "admin all sales" on sales for all to authenticated using (is_admin()) with check (is_admin());
drop trigger if exists sales_updated_at on sales;
create trigger sales_updated_at before update on sales
  for each row execute function set_updated_at();

-- ─── C) Homepage announcement strip ────────────────────────────────────────
-- Editable from admin (Discounts tab). Used by site_banner / homepage to surface
-- the current bulk-discount messaging.
alter table site_settings add column if not exists announcement_active boolean default false;
alter table site_settings add column if not exists announcement_text text;
alter table site_settings add column if not exists announcement_link text;       -- optional CTA destination (default /catalog)
alter table site_settings add column if not exists announcement_cta_label text;  -- e.g. "Shop the catalog"
