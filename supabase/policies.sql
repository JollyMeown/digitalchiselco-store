-- Row-Level Security for DigitalChiselCo
-- Public can READ catalog display data only. Download links, orders, customer
-- data stay private (served server-side via service_role / entitlement checks).

-- enable RLS everywhere
alter table products            enable row level security;
alter table categories          enable row level security;
alter table product_categories  enable row level security;
alter table product_downloads   enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table entitlements        enable row level security;
alter table profiles            enable row level security;
alter table coupons             enable row level security;

-- ---- PUBLIC READ: catalog display (no download links here) ----
create policy "public read products"   on products           for select using (active = true);
create policy "public read categories" on categories         for select using (true);
create policy "public read prod_cats"  on product_categories for select using (true);

-- product_downloads: NO public policy => only service_role (server) can read.
-- orders / order_items / coupons: NO public policy => server-only.

-- ---- CUSTOMER: see their own data (for the account dashboard) ----
create policy "own profile"      on profiles     for select using (auth.uid() = id);
create policy "update own profile" on profiles   for update using (auth.uid() = id);
create policy "own orders"       on orders       for select using (auth.uid() = customer_id);
create policy "own entitlements" on entitlements for select using (auth.uid() = customer_id);
