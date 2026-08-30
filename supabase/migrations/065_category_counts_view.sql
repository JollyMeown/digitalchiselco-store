-- 065: per-category active-product counts for the storefront side menu
-- (Etsy-style "Category  123" numbers). One cheap aggregate query per page
-- render instead of N per-category counts. SECURITY DEFINER view (not
-- invoker) so the anon storefront can read the aggregate regardless of the
-- underlying tables' RLS; it exposes nothing but public catalog counts.
create or replace view public.v_category_counts as
  select pc.category_id, count(*)::int as active_count
  from public.product_categories pc
  join public.products p on p.id = pc.product_id
  where p.active = true and p.price_usd > 0
  group by pc.category_id;

grant select on public.v_category_counts to anon, authenticated;
