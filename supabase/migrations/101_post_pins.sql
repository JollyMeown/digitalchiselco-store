-- Pinterest Pins for the guides (owner request 2026-09-05): every article gets
-- a purpose-built 2:3 poster with its title set into it, plus Pin title and
-- description written for Pinterest search. Published through the RSS feed
-- Pinterest already polls (the API route is still awaiting access approval).
alter table public.posts add column if not exists pin_image_url   text;
alter table public.posts add column if not exists pin_title       text;
alter table public.posts add column if not exists pin_description text;
alter table public.posts add column if not exists pin_at          timestamptz;   -- when the poster was (re)built; drives the feed's pubDate
comment on column public.posts.pin_image_url is '1000x1500 poster built by scripts/blog/compose_pins.mjs (Gemini scene + title as paths).';
