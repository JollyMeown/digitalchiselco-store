-- Customizable products. Admins flip products.is_customizable, then define
-- per-product input fields the customer must fill at checkout. Phase 2 will
-- store the captured values against order_items; this migration is just the
-- definitional side.

alter table public.products
  add column if not exists is_customizable boolean not null default false;

create table if not exists public.product_custom_fields (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null,
  field_key text not null,
  field_type text not null check (field_type in ('text','email','date','textarea','file_url','phone','number')),
  required boolean not null default false,
  placeholder text,
  help_text text,
  max_length int,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, field_key)
);

create index if not exists idx_product_custom_fields_product
  on public.product_custom_fields(product_id, sort_order);

alter table public.product_custom_fields enable row level security;

drop policy if exists "public read product_custom_fields" on public.product_custom_fields;
create policy "public read product_custom_fields" on public.product_custom_fields
  for select using (true);

drop policy if exists "admin all product_custom_fields" on public.product_custom_fields;
create policy "admin all product_custom_fields" on public.product_custom_fields
  for all to authenticated
  using (is_admin())
  with check (is_admin());
