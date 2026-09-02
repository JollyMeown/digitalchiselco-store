-- "After" snapshot for the Etsy SEO rewrite experiment, refreshed daily by the
-- local stats task, so the admin can show before -> after for views, favourites
-- AND sales per rewritten listing without opening Etsy.
alter table public.etsy_seo_experiment
  add column if not exists views_now integer,
  add column if not exists favorers_now integer,
  add column if not exists sales_now integer,
  add column if not exists checked_at timestamptz;
