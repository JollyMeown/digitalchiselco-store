-- When each Etsy listing was first published (owner 2026-09-09, asking whether
-- advertising should be switched on for every new listing).
--
-- Without an age, "this listing has no sales" is unanswerable: a listing
-- published last week and one published last year look identical. With it, the
-- dashboard can show the real shape of the shop's history, which on the first
-- reading was stark: 2% of listings under 60 days old have ever sold, against
-- 82% of those over 180 days. A new listing is not a slow seller, it is an
-- unproven one, and the two deserve different money.
alter table public.etsy_listing_stats add column if not exists listing_created date;
create index if not exists etsy_listing_stats_created_idx on public.etsy_listing_stats (listing_created desc);
