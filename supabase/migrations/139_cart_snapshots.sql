-- Saved carts, visible to the owner.
--
-- The cart lives in the shopper's browser (localStorage), so on 2026-09-16 the
-- admin could see "1 at cart RIGHT NOW" but not what was in it, and a
-- returning shopper with a cart saved days earlier looked like a stranger.
-- Each browser now carries a random anonymous id (dcc_bid, no personal data)
-- and reports its cart here whenever it changes or a page is viewed with
-- something in it. The email is present only if the shopper typed it on the
-- site themselves (cart or sign-up).
create table if not exists public.cart_snapshots (
  browser_id      text primary key,
  items           jsonb not null default '[]'::jsonb,   -- [{id,title,price,slug,image_url}]
  item_count      integer not null default 0,
  total_usd       numeric(10,2) not null default 0,
  email           text,
  status          text not null default 'open' check (status in ('open', 'converted', 'emptied')),
  converted_txn   text,
  first_saved_at  timestamptz not null default now(),   -- when this cart started
  updated_at      timestamptz not null default now(),   -- contents last changed
  last_seen_at    timestamptz not null default now(),   -- last page view with this cart
  last_path       text,
  visits          integer not null default 1,           -- page views while the cart held something
  country         text,
  device          text
);
create index if not exists cart_snapshots_seen_idx on public.cart_snapshots (status, last_seen_at desc);

alter table public.cart_snapshots enable row level security;
drop policy if exists "cart_snapshots_admin_read" on public.cart_snapshots;
create policy "cart_snapshots_admin_read" on public.cart_snapshots for select using (is_admin());
