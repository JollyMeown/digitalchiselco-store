-- Bundle Composer: track which source products make up a bundle product.
-- A "bundle" is still a normal row in `products` (is_bundle=true). bundle_items
-- pins which source products it was composed from, so the admin can regenerate
-- the bundle's gallery / download links if a source product changes later.
create table if not exists bundle_items (
  id                 uuid primary key default gen_random_uuid(),
  bundle_product_id  uuid not null references products(id) on delete cascade,
  source_product_id  uuid not null references products(id) on delete cascade,
  sort_order         int default 0,
  created_at         timestamptz default now(),
  unique (bundle_product_id, source_product_id)
);
create index if not exists bundle_items_bundle_idx on bundle_items(bundle_product_id);
alter table bundle_items enable row level security;
drop policy if exists "admin all bundle_items" on bundle_items;
create policy "admin all bundle_items" on bundle_items for all to authenticated
  using (is_admin()) with check (is_admin());

-- "Carved by you" — customer-creation showcase shown on the homepage.
create table if not exists customer_creations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,                              -- maker's display name
  description     text,
  gallery         jsonb default '[]'::jsonb,                  -- array of image urls
  product_id      uuid references products(id) on delete set null,  -- optional link to the source product
  product_url     text,                                       -- fallback if not in catalog
  active          boolean default true,
  is_featured     boolean default false,
  sort_order      int default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists customer_creations_active_idx on customer_creations(active);
alter table customer_creations enable row level security;
drop policy if exists "public read customer_creations" on customer_creations;
create policy "public read customer_creations" on customer_creations for select using (active = true);
drop policy if exists "admin all customer_creations" on customer_creations;
create policy "admin all customer_creations" on customer_creations for all to authenticated
  using (is_admin()) with check (is_admin());
drop trigger if exists customer_creations_updated_at on customer_creations;
create trigger customer_creations_updated_at before update on customer_creations
  for each row execute function set_updated_at();

-- Orders: soft-delete + admin notes (for refund/cancel context)
alter table orders add column if not exists deleted_at timestamptz;
alter table orders add column if not exists admin_note text;
create index if not exists orders_deleted_idx on orders(deleted_at);
