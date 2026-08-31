-- 069: products uploaded from OTHER shops' BRS studios (not the admin machine)
-- land as PENDING moderation — inactive until the admin reviews, assigns the
-- right category/price and approves them in the dashboard.
alter table public.products
  add column if not exists pending_review boolean default false,
  add column if not exists submitted_by text;

create index if not exists idx_products_pending
  on public.products (pending_review) where pending_review;
