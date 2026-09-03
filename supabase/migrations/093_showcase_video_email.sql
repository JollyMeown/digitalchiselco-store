-- Per-film email copy for Sawdust Cinema.
--
-- The film email used to open with a line hardcoded to the Highland cow film
-- ("just a Highland cow, a lot of oak and one very patient wife") and a fixed
-- "31 seconds" runtime. Sent under any other film -- a devotional carving, say --
-- that copy is wrong and, for a sacred subject, offensive.
--
-- So the opening line, the subject and the runtime now travel WITH the film.
-- BRS writes them when it publishes; the admin can edit them before sending.
alter table public.showcase_videos
  add column if not exists email_intro   text,   -- the 1-2 sentence opener
  add column if not exists email_subject text,   -- overrides the generated subject
  add column if not exists runtime_seconds integer;

comment on column public.showcase_videos.email_intro is
  'Opening line(s) of the film email. Written per film. Falls back to a neutral line.';
comment on column public.showcase_videos.email_subject is
  'Subject line for the film email. Blank = generated from the title and runtime.';
comment on column public.showcase_videos.runtime_seconds is
  'True length of the film, so the email never claims a runtime it does not have.';

-- keep the original Highland cow copy on the film it was actually written for
update public.showcase_videos
   set email_intro = coalesce(email_intro,
         'We made a little film. No sales pitch, just a Highland cow, a lot of oak and one very patient wife.'),
       runtime_seconds = coalesce(runtime_seconds, 31)
 where title ilike '%made of oak%';
