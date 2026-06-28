-- Captured customization values per order line. Stored as an ordered JSON
-- array of { key, label, type, value } so we keep the label snapshot — if
-- the admin later edits or deletes the field definition, old orders still
-- render correctly.

create table if not exists public.order_item_customizations (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  fields jsonb not null,  -- [{ key, label, type, value }]
  created_at timestamptz not null default now()
);

create index if not exists idx_order_item_customizations_order_item
  on public.order_item_customizations(order_item_id);

alter table public.order_item_customizations enable row level security;

drop policy if exists "admin read order_item_customizations" on public.order_item_customizations;
create policy "admin read order_item_customizations" on public.order_item_customizations
  for select to authenticated using (is_admin());

-- The webhook writes via service_role; no insert policy needed for browser clients.

-- ───── "Made for You" category ─────
-- Seed a customizable-products category. The admin can re-style it (image,
-- description, sort) via the Categories tab — we just create the row here.
insert into public.categories (name, slug, description, sort_order)
values (
  'Made for You',
  'made-for-you',
  '✨ Personalized 3D designs — share a name, a date, or a photo, and we''ll carve a one-of-a-kind STL just for you. Perfect for weddings, anniversaries, family portraits and keepsakes that mean everything.',
  -90
)
on conflict (slug) do nothing;
