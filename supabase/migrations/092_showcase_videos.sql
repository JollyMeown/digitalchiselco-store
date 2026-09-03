-- "Sawdust Cinema": short product films on the homepage (2026-09-03).
--
-- Kept in its own table rather than reusing products.video_url, because that
-- column already holds 1,253 imported Etsy clips. These are the hand-made
-- showcase films, each one pointing at the product it is about, ordered and
-- switched on by the owner.
create table if not exists public.showcase_videos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product_id uuid references public.products(id) on delete set null,
  -- the film itself, plus a still for the poster frame so nothing downloads
  -- until the visitor presses play
  video_url text not null,
  poster_url text,
  title text,                  -- overrides the product title on the card
  caption text,                -- one line under the title
  sort_order integer not null default 0,
  active boolean not null default true
);

alter table public.showcase_videos enable row level security;
do $$ begin
  execute 'drop policy if exists showcase_videos_read on public.showcase_videos';
  execute 'create policy showcase_videos_read on public.showcase_videos for select to anon, authenticated using (active)';
  execute 'drop policy if exists showcase_videos_admin on public.showcase_videos';
  execute 'create policy showcase_videos_admin on public.showcase_videos for all to authenticated using (public.is_admin()) with check (public.is_admin())';
end $$;

create index if not exists showcase_videos_order_idx on public.showcase_videos (sort_order, created_at desc) where active;
