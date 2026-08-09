-- Product showcase video (pulled from the matching Etsy listing via the API).
-- Stored as the Etsy CDN URL + poster thumbnail; shown on the product page.
alter table products
  add column if not exists video_url   text,
  add column if not exists video_thumb text;
