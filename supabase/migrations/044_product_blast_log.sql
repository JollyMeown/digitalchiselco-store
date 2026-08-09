-- "Send this product to its interested audience" dedup log.
-- One row per (product, recipient) we've spotlighted, so re-running the blast
-- for the same design never emails the same person twice.
create table if not exists product_blast_log (
  product_id uuid not null references products(id) on delete cascade,
  email      text not null,
  sent_at    timestamptz not null default now(),
  primary key (product_id, email)
);
alter table product_blast_log enable row level security;
drop policy if exists "admin read product_blast_log" on product_blast_log;
create policy "admin read product_blast_log" on product_blast_log
  for select to authenticated using (is_admin());
-- writes happen server-side via the service-role key
