-- product_categories was missing an admin write policy. RLS was enabled and a
-- public SELECT policy existed, but with no INSERT/UPDATE/DELETE policy every
-- admin-side category change was silently dropped (Postgres returns 0 rows
-- affected instead of erroring). This matches the pattern used on products,
-- categories, and bundle_items.

drop policy if exists "admin all product_categories" on public.product_categories;

create policy "admin all product_categories" on public.product_categories
  for all to authenticated
  using (is_admin())
  with check (is_admin());
