-- ---------- Admin dashboard expansion (2026-06-26) ----------
-- Adds: discount + hero/featured fields on site_settings, admin RLS for orders/
-- order_items/entitlements, Storage bucket "site-media" for admin uploads.

-- site_settings: discount + hero
alter table site_settings add column if not exists discount_percent int default 20 check (discount_percent between 0 and 90);
alter table site_settings add column if not exists hero_image_url text;
alter table site_settings add column if not exists hero_headline text default 'Art that carves with purpose';
alter table site_settings add column if not exists hero_subhead text default 'Hundreds of museum-grade bas-relief designs, instantly downloadable. Half of every purchase goes to charity.';
alter table site_settings add column if not exists featured_product_id uuid references products(id) on delete set null;

-- admin can also write orders / order_items / entitlements (e.g., refund flag,
-- mark paid manually, regenerate entitlement). Public still has no policy => no access.
drop policy if exists "admin all orders" on orders;
create policy "admin all orders" on orders for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "admin all order_items" on order_items;
create policy "admin all order_items" on order_items for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "admin all entitlements" on entitlements;
create policy "admin all entitlements" on entitlements for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "admin all coupons" on coupons;
create policy "admin all coupons" on coupons for all to authenticated
  using (is_admin()) with check (is_admin());

-- helpful index for orders dashboard (recent first)
create index if not exists orders_created_at_idx on orders(created_at desc);

-- ---------- Storage bucket for admin uploads (hero/category/product images) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 10485760, array['image/jpeg','image/png','image/webp','image/avif','image/gif','image/svg+xml'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read on the bucket; admin can manage objects.
drop policy if exists "public read site-media" on storage.objects;
create policy "public read site-media" on storage.objects for select using (bucket_id = 'site-media');

drop policy if exists "admin upload site-media" on storage.objects;
create policy "admin upload site-media" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and is_admin());

drop policy if exists "admin update site-media" on storage.objects;
create policy "admin update site-media" on storage.objects for update to authenticated
  using (bucket_id = 'site-media' and is_admin()) with check (bucket_id = 'site-media' and is_admin());

drop policy if exists "admin delete site-media" on storage.objects;
create policy "admin delete site-media" on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and is_admin());
