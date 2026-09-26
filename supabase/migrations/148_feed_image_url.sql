-- Optional main picture for the Google feed only (2026-09-26). The 14
-- Stations of the Cross bundle's site hero is a collage with price text,
-- which Google refuses; its Shopping picture is a clean grid of the 14 real
-- renders instead. Empty = the feed keeps its usual choice.
alter table public.products add column if not exists feed_image_url text;
