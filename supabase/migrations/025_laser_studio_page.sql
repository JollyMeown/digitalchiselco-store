-- Laser Studio marketing page: admin-managed image slots + buy-button link.
alter table site_settings add column if not exists ls_buy_url text;
alter table site_settings add column if not exists ls_hero_url text;
alter table site_settings add column if not exists ls_styles_url text;
alter table site_settings add column if not exists ls_relief_url text;
alter table site_settings add column if not exists ls_starmap_url text;
alter table site_settings add column if not exists ls_sundial_url text;
alter table site_settings add column if not exists ls_recipe_url text;
alter table site_settings add column if not exists ls_tumbler_url text;
alter table site_settings add column if not exists ls_proof_url text;
