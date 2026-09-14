-- Where the 5 free STL files actually live.
--
-- Until now this link existed in exactly one place: inside a MailerLite
-- automation email. If a subscriber lost that email the website had no way to
-- give it back, so every request came to the owner by hand ("I cannot find the
-- original e-mail with the download link. Please send again."). 96 people have
-- confirmed for the free pack, 43 of them in the last 30 days, so that queue
-- only grows.
--
-- Keeping it as a setting rather than a constant means the folder can be
-- swapped (or the pack refreshed) without a deploy.
alter table public.growth_settings
  add column if not exists free_pack_url text;

update public.growth_settings
   set free_pack_url = 'https://drive.google.com/drive/folders/15MNatyebOXkw-C27j4Kt4TX4purvTduE?usp=drive_open'
 where id = 1 and (free_pack_url is null or free_pack_url = '');
