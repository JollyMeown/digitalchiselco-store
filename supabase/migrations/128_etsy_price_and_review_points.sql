-- Two things the sales pass of 2026-09-15 needs.
--
-- 1) The real Etsy price per listing, synced daily. The website sells at a
--    lower price than Etsy and never said so; a buyer only found out when we
--    wrote it to her by hand. The product page can now state it honestly,
--    from the listing's own price, not a guessed ratio (the site price is not
--    a fixed 80%: $7.99 here vs $8.99 there is 89%).
alter table public.etsy_listing_stats
  add column if not exists price_usd numeric(10,2);

-- 2) Loyalty points for a written review. 1,758 of 1,876 products show no
--    stars, and stars are what stop a scanning eye. Points land when the
--    review is APPROVED (not submitted), once per review, only when the
--    reviewer left an email, and only while loyalty is switched on. The
--    ledger row carries the review id in coupon_code as the idempotency key.
create or replace function public.review_points_on_approve()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  on_ boolean;
  pts int;
begin
  if new.status = 'approved' and coalesce(old.status, '') <> 'approved'
     and new.email is not null and new.email <> ''
     and new.source = 'website' then
    select loyalty_enabled into on_ from site_settings limit 1;
    if coalesce(on_, false) then
      pts := case when new.photo_url is not null and new.photo_url <> '' then 150 else 100 end;
      insert into loyalty_ledger (email, points, reason, coupon_code)
      select lower(new.email), pts, 'review', 'review:' || new.id::text
      where not exists (select 1 from loyalty_ledger where coupon_code = 'review:' || new.id::text);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists reviews_points_on_approve on public.reviews;
create trigger reviews_points_on_approve
  after update of status on public.reviews
  for each row execute function public.review_points_on_approve();
