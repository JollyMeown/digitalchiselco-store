-- Product videos are pointers only, never files on our side. Whatever machine
-- writes the row (owner's BRS, a fleet BRS, a script), the database refuses
-- anything but an Etsy CDN video URL or a YouTube video id.
alter table public.products drop constraint if exists products_video_url_etsy_cdn;
alter table public.products add constraint products_video_url_etsy_cdn
  check (video_url is null or video_url like 'https://v.etsystatic.com/%');
alter table public.products drop constraint if exists products_video_thumb_etsy_cdn;
alter table public.products add constraint products_video_thumb_etsy_cdn
  check (video_thumb is null or video_thumb like 'https://%etsystatic.com/%');
alter table public.products drop constraint if exists products_youtube_video_id_shape;
alter table public.products add constraint products_youtube_video_id_shape
  check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');
