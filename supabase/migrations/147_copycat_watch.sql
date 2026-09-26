-- Copycat Watch (2026-09-26): look for Etsy listings that reuse our product
-- pictures (or copy a title word for word) for our best-selling designs.
-- Filled by lib/copycat.ts (nightly step + Admin "Check now"); read and
-- updated only through /api/admin/copycat with the service role.

create table if not exists public.copycat_matches (
  id               bigint generated always as identity primary key,
  product_id       uuid not null references public.products(id) on delete cascade,
  etsy_listing_id  bigint not null,
  shop_id          bigint,
  shop_name        text,
  title            text,
  url              text,
  image_url        text,
  price            text,
  image_distance   int,            -- picture difference, 0 = identical picture (64-bit dHash)
  title_overlap    numeric,        -- 0..1 share of meaningful title words in common
  kind             text not null,  -- 'image' (our picture reused) | 'title' (title copied)
  status           text not null default 'new',   -- new | reported | ignored | removed
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  unique (product_id, etsy_listing_id)
);
create index if not exists copycat_matches_status_idx on public.copycat_matches (status, last_seen desc);

create table if not exists public.copycat_checks (
  product_id  uuid primary key references public.products(id) on delete cascade,
  checked_at  timestamptz not null default now(),
  results     int not null default 0,     -- Etsy listings looked at
  matches     int not null default 0
);

alter table public.copycat_matches enable row level security;
alter table public.copycat_checks enable row level security;
grant select, insert, update, delete on public.copycat_matches to service_role;
grant select, insert, update, delete on public.copycat_checks to service_role;
grant usage, select on sequence public.copycat_matches_id_seq to service_role;
