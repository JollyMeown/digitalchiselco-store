-- Correction to 118. The first version tested the slug with an anchored
-- pattern, so it only exempted slugs BEGINNING with "membership". A live
-- membership offer whose slug merely contained the word
-- ("6-67-month-membership-last-call-for-cnc-carvers", $24.99) was taken off the
-- storefront by the sweep, which was wrong: memberships are fulfilled by the
-- subscription engine and correctly have no product_downloads row.
--
-- The exemption is now defined by what a product IS, not by how its slug reads:
-- products.is_subscription or a membership_plan_slug means the download engine
-- was never going to deliver it. The slug patterns stay only as a safety net
-- for older rows that predate those columns.

create or replace function public.products_require_download()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  exempt boolean;
begin
  exempt :=
       coalesce(new.is_subscription, false)
    or new.membership_plan_slug is not null
    or coalesce(new.slug, '') ilike 'gift-card%'
    or coalesce(new.slug, '') ilike '%membership%';

  if new.active is true
     and coalesce(new.price_usd, 0) > 0
     and not exempt
     and not exists (select 1 from public.product_downloads d where d.product_id = new.id)
  then
    new.active := false;
    new.held_missing_file := true;
  elsif new.active is true then
    new.held_missing_file := false;
  end if;
  return new;
end;
$$;

-- Put back anything the 118 sweep should never have touched. Only rows it
-- flagged are considered, so a product the owner deactivated by hand stays off.
update public.products
   set active = true, held_missing_file = false
 where held_missing_file is true
   and (coalesce(is_subscription, false)
        or membership_plan_slug is not null
        or coalesce(slug, '') ilike 'gift-card%'
        or coalesce(slug, '') ilike '%membership%');
