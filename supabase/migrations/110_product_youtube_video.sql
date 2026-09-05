-- Owner 2026-09-06: products BRS publishes without an Etsy video can show the
-- YouTube Short BRS made for them instead. BRS writes the YouTube video id on
-- the product; the page embeds it click-to-play (YouTube hosts it, zero load).
alter table public.products add column if not exists youtube_video_id text;
comment on column public.products.youtube_video_id is 'YouTube video id (11 chars) of the product''s own Short/film; shown on the product page when there is no Etsy video.';
