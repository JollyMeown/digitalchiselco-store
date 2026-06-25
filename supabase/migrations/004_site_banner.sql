-- Site-wide banner image (top of every storefront page except cart/checkout).
alter table site_settings add column if not exists banner_image_url text;
