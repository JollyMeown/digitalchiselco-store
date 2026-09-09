-- A sellable product may not be live without a download file (owner
-- 2026-09-09: "It should not upload the product if it has missing file").
--
-- One product slipped through on 2026-09-07 and sat on the storefront for two
-- days: a buyer could have paid $8.39 and received nothing, because fulfilment
-- reads only product_downloads. The Overview tile caught it, but a warning
-- after the fact is not a guard.
--
-- Enforced in the DATABASE, not in an API route, because products arrive from
-- several BRS machines and scripts that write to Supabase directly. Anything
-- that only lives in one route can be walked around by the next one.
--
-- The guard HOLDS rather than REJECTS. Uploads legitimately arrive as two
-- writes, the product first and its file a moment later, so refusing the insert
-- would break every normal upload. Instead the product is saved as an inactive
-- draft and flagged, and the moment its file arrives it publishes itself. The
-- owner never has to remember to come back to it.

alter table public.products add column if not exists held_missing_file boolean not null default false;
comment on column public.products.held_missing_file is
  'Held back from the storefront because it has no product_downloads row. Cleared automatically when the file arrives.';

create or replace function public.products_require_download()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- only sellable, live products are policed; free items, gift cards and
  -- memberships are delivered by other means and have no download row
  if new.active is true
     and coalesce(new.price_usd, 0) > 0
     and coalesce(new.slug, '') !~* '^(gift-card|membership)'
     and not exists (select 1 from public.product_downloads d where d.product_id = new.id)
  then
    new.active := false;
    new.held_missing_file := true;
  elsif new.active is true then
    -- it is live and has a file, so it is not being held
    new.held_missing_file := false;
  end if;
  return new;
end;
$$;

drop trigger if exists products_require_download_ins on public.products;
create trigger products_require_download_ins
  before insert on public.products
  for each row execute function public.products_require_download();

-- On update the check only needs to run when activation or price actually
-- changes, so the nightly stats syncs that touch every row stay cheap.
drop trigger if exists products_require_download_upd on public.products;
create trigger products_require_download_upd
  before update of active, price_usd, slug on public.products
  for each row execute function public.products_require_download();

-- The release side: when the missing file finally arrives, publish the product.
create or replace function public.products_release_on_download()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
     set active = true, held_missing_file = false
   where id = new.product_id
     and held_missing_file is true;
  return new;
end;
$$;

drop trigger if exists product_downloads_release on public.product_downloads;
create trigger product_downloads_release
  after insert on public.product_downloads
  for each row execute function public.products_release_on_download();

-- Sweep up whatever is already live without a file, which is the state that
-- prompted this. They become drafts and will publish themselves on upload.
update public.products p
   set active = false, held_missing_file = true
 where p.active is true
   and coalesce(p.price_usd, 0) > 0
   and coalesce(p.slug, '') !~* '^(gift-card|membership)'
   and not exists (select 1 from public.product_downloads d where d.product_id = p.id);
