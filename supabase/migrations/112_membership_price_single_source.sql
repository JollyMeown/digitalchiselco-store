-- Owner rule 2026-09-06: a membership price is changed in ONE place
-- (membership_plans.price_usd) and every location follows. Memberships that
-- are also sold as catalogue products (products.membership_plan_slug) keep
-- their price_usd in step with the plan, both when the plan changes and when
-- such a product is created or re-pointed at a plan.
create or replace function public.sync_membership_product_prices() returns trigger language plpgsql as $$
begin
  update public.products set price_usd = new.price_usd
   where membership_plan_slug = new.slug and price_usd is distinct from new.price_usd;
  return new;
end $$;
drop trigger if exists membership_plans_sync_product_prices on public.membership_plans;
create trigger membership_plans_sync_product_prices after update of price_usd on public.membership_plans
  for each row execute function public.sync_membership_product_prices();

create or replace function public.membership_product_price_from_plan() returns trigger language plpgsql as $$
declare v numeric;
begin
  if new.membership_plan_slug is not null then
    select price_usd into v from public.membership_plans where slug = new.membership_plan_slug;
    if v is not null then new.price_usd := v; end if;
  end if;
  return new;
end $$;
drop trigger if exists products_membership_price_from_plan on public.products;
create trigger products_membership_price_from_plan before insert or update of membership_plan_slug, price_usd on public.products
  for each row execute function public.membership_product_price_from_plan();

-- bring today's rows in line
update public.products p set price_usd = m.price_usd
  from public.membership_plans m where p.membership_plan_slug = m.slug and p.price_usd is distinct from m.price_usd;
