-- Real sales ranking per product, from Etsy receipts (2026-09-03).
--
-- Website orders are a tiny fraction of sales (30 rows) because almost every
-- sale happens on Etsy, so "our best sellers" can only be answered from Etsy
-- receipts. scripts/etsy_sales_rank.mjs fills these on the machine that holds
-- the Etsy token; everything else (marketing image batches, admin coverage,
-- bundle picks) can then just ORDER BY etsy_sales_365.
alter table public.products
  add column if not exists etsy_sales_365 integer not null default 0,
  add column if not exists etsy_sales_at timestamptz;

create index if not exists products_etsy_sales_idx
  on public.products (etsy_sales_365 desc) where active;
