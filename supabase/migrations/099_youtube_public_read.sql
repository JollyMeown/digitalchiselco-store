-- The storefront shows a "Watch on YouTube" badge on every product that has a
-- public Short, and the main menu can filter the catalog to those products.
-- youtube_stats is admin-only (094); this opens READ access to the PUBLIC rows
-- only, which carry nothing beyond what YouTube itself shows.
do $$ begin
  execute 'drop policy if exists youtube_stats_public_read on public.youtube_stats';
  execute 'create policy youtube_stats_public_read on public.youtube_stats for select to anon, authenticated using (privacy = ''public'')';
end $$;

create index if not exists youtube_stats_product_public_idx
  on public.youtube_stats (product_id) where privacy = 'public';
