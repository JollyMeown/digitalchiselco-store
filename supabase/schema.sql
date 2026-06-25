-- DigitalChiselCo — store schema (Supabase / Postgres)
-- Run in Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type link_status as enum ('certain','likely','review','bundle_manual','verified','broken');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pending','paid','refunded','failed','canceled');
exception when duplicate_object then null; end $$;

-- ---------- categories ----------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  image_url   text,
  sort_order  int  default 0,
  created_at  timestamptz default now()
);

-- ---------- products ----------
create table if not exists products (
  id              uuid primary key default gen_random_uuid(),
  etsy_listing_id text unique,
  title           text not null,
  slug            text not null unique,
  description     text,
  price_usd       numeric(10,2) not null default 0,
  image_url       text,
  gallery         jsonb default '[]'::jsonb,
  is_bundle       boolean default false,
  is_subscription boolean default false,
  active          boolean default true,
  -- delivery / link verification
  link_status     link_status default 'review',  -- drives the admin color marker
  link_verified   boolean default false,          -- user re-verified the link works
  seo_title       text,
  seo_description text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists products_active_idx on products(active);
create index if not exists products_link_status_idx on products(link_status);

-- ---------- product download files (1 product -> many files; bundles) ----------
create table if not exists product_downloads (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  file_name     text,
  drive_file_id text,
  download_link text not null,        -- https://drive.google.com/uc?export=download&id=...
  size_bytes    bigint,
  is_large      boolean default false,-- >100MB => Google interstitial, flag in admin
  sort_order    int default 0,
  created_at    timestamptz default now()
);
create index if not exists product_downloads_product_idx on product_downloads(product_id);

-- ---------- product <-> category (M2M) ----------
create table if not exists product_categories (
  product_id  uuid references products(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  primary key (product_id, category_id)
);

-- ---------- customers (extends auth.users) ----------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  is_admin    boolean default false,
  created_at  timestamptz default now()
);

-- ---------- orders ----------
create table if not exists orders (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references profiles(id) on delete set null,
  email             text not null,                -- guest checkout supported
  status            order_status default 'pending',
  currency          text default 'USD',
  subtotal          numeric(10,2) default 0,
  total             numeric(10,2) default 0,
  provider          text,                         -- 'paddle' | 'gumroad' | ...
  provider_order_id text,
  created_at        timestamptz default now()
);
create index if not exists orders_email_idx on orders(email);
create index if not exists orders_customer_idx on orders(customer_id);

create table if not exists order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  title       text,
  price_usd   numeric(10,2),
  qty         int default 1
);
create index if not exists order_items_order_idx on order_items(order_id);

-- ---------- entitlements: what a buyer may download ----------
create table if not exists entitlements (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references orders(id) on delete cascade,
  customer_id uuid references profiles(id) on delete set null,
  email       text not null,
  product_id  uuid references products(id) on delete set null,
  granted_at  timestamptz default now(),
  download_count int default 0
);
create index if not exists entitlements_email_idx on entitlements(email);
create index if not exists entitlements_customer_idx on entitlements(customer_id);

-- ---------- coupons (basic) ----------
create table if not exists coupons (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  percent_off int check (percent_off between 1 and 100),
  active      boolean default true,
  expires_at  timestamptz
);

-- ---------- admin view: links needing verification (color marker source) ----------
create or replace view admin_link_review as
  select id, title, slug, link_status, link_verified,
         (select count(*) from product_downloads d where d.product_id = p.id) as n_files
  from products p
  where link_status in ('review','bundle_manual') or link_verified = false
  order by case link_status when 'bundle_manual' then 0 when 'review' then 1 else 2 end;

-- ---------- updated_at trigger ----------
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists products_updated_at on products;
create trigger products_updated_at before update on products
  for each row execute function set_updated_at();
