-- Optional Etsy store link under the homepage stats (the stats are Etsy-backed).
-- Owner toggles visibility + edits the URL in Admin → Settings.
alter table site_settings add column if not exists etsy_link_enabled boolean not null default false;
alter table site_settings add column if not exists etsy_store_url text default 'https://www.etsy.com/shop/DigitalChiselCo';
