-- "Frequently bought together": designs real buyers put in the same order.
--
-- Built by scripts/build_product_pairs.mjs from Etsy receipts (the shop's
-- real volume: ~3,900 orders a year) plus website orders. One row per
-- ordered pair; `together` = how many separate orders held both.
-- Aggregate counts only, no buyer data, so the storefront may read it.
create table if not exists public.product_pairs (
  product_id  uuid not null references public.products(id) on delete cascade,
  pair_id     uuid not null references public.products(id) on delete cascade,
  together    integer not null,
  source      text not null default 'etsy+web',
  updated_at  timestamptz not null default now(),
  primary key (product_id, pair_id)
);
create index if not exists product_pairs_rank_idx on public.product_pairs (product_id, together desc);

alter table public.product_pairs enable row level security;
drop policy if exists "product_pairs_read" on public.product_pairs;
create policy "product_pairs_read" on public.product_pairs for select using (true);
drop policy if exists "product_pairs_admin_write" on public.product_pairs;
create policy "product_pairs_admin_write" on public.product_pairs
  for all using (is_admin()) with check (is_admin());
