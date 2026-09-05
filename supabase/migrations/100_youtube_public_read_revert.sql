-- Reverts 099: the owner wants the YouTube marks and the "YouTube films" switch
-- inside BRS only, not on the storefront. youtube_stats goes back to admin-only.
do $$ begin
  execute 'drop policy if exists youtube_stats_public_read on public.youtube_stats';
end $$;
drop index if exists public.youtube_stats_product_public_idx;
