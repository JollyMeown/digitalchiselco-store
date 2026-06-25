-- Site settings (editable in admin) + admin auth helpers/policies

create table if not exists site_settings (
  id              int primary key default 1,
  donation_total  numeric(12,2) default 7670,
  rating          numeric(2,1)  default 4.9,
  reviews_count   int default 577,
  sales_count     int default 4543,
  products_count  int default 1235,
  admirers_count  int default 505,
  experience_years int default 20,
  admin_email     text default 'jolly@digitalchiselco.com',
  updated_at      timestamptz default now(),
  constraint single_row check (id = 1)
);
insert into site_settings (id) values (1) on conflict (id) do nothing;
alter table site_settings enable row level security;

-- is_admin(): true if the logged-in user is flagged admin in profiles
create or replace function is_admin() returns boolean
  language sql security definer stable as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin);
$$;

-- settings: public read, admin write
drop policy if exists "public read settings" on site_settings;
create policy "public read settings" on site_settings for select using (true);
drop policy if exists "admin write settings" on site_settings;
create policy "admin write settings" on site_settings for all to authenticated
  using (is_admin()) with check (is_admin());

-- admin can read/write catalog (adds to existing public-read policies via OR)
drop policy if exists "admin all products" on products;
create policy "admin all products" on products for all to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists "admin all categories" on categories;
create policy "admin all categories" on categories for all to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists "admin all product_downloads" on product_downloads;
create policy "admin all product_downloads" on product_downloads for all to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists "admin read subscribers" on subscribers;
create policy "admin read subscribers" on subscribers for select to authenticated using (is_admin());
drop policy if exists "admin read orders" on orders;
create policy "admin read orders" on orders for select to authenticated using (is_admin());
