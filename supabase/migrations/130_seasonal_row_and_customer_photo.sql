-- Two sales features from the 2026-09-15 pass.
--
-- 1) A seasonal row on the homepage, driven by settings so the owner can point
--    it at Halloween now and Christmas in November without a deploy. Empty
--    slug or a past date = no row.
alter table public.site_settings
  add column if not exists seasonal_slug  text,
  add column if not exists seasonal_label text,
  add column if not exists seasonal_until date;

-- 2) A real customer's carving photo on the product card. When a website review
--    with a photo is approved, the newest such photo is copied onto the product,
--    and the card shows it in place of the render on hover. A real carve on a
--    real wall outsells a render; this is what the 150-point photo reward is for.
alter table public.products
  add column if not exists customer_photo_url text;

create or replace function public.product_customer_photo_on_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and new.photo_url is not null and new.photo_url <> ''
     and new.product_id is not null and new.source = 'website' then
    update products set customer_photo_url = new.photo_url where id = new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists reviews_customer_photo on public.reviews;
create trigger reviews_customer_photo
  after insert or update of status on public.reviews
  for each row execute function public.product_customer_photo_on_review();

-- backfill from photos already approved
update products p
   set customer_photo_url = r.photo_url
  from (
    select distinct on (product_id) product_id, photo_url
      from reviews
     where status = 'approved' and source = 'website' and photo_url is not null and photo_url <> '' and product_id is not null
     order by product_id, created_at desc
  ) r
 where r.product_id = p.id and p.customer_photo_url is null;
