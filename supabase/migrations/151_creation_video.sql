-- "Carved by you": a short video per creation (2026-10-01).
--
-- A maker (Jeff Miller, Burl & Curl Woodworking) sent photos of his Military
-- Memorial tray AND an 11-second clip of the bit cutting it. The wall could only
-- hold photos. One optional MP4 URL per entry; the card shows the finished photo
-- with a "Watch it carve" button that swaps in the video.
--
-- New COLUMN on an existing table: the table's grants and RLS already cover it.
alter table public.customer_creations add column if not exists video_url text;
comment on column public.customer_creations.video_url is 'Optional short MP4 (H.264, in the site-media bucket) shown on the Carved by you card behind a Watch button.';
