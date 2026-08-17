-- (F2) Coupon holds: single-use / capped codes (GIFT-, CREDIT-, THANKS-…) could
-- be double-spent by opening N tabs — the cap was checked at checkout-init and
-- only counted at payment. reserve_coupon() atomically checks
-- redemptions + live holds < max and records a 30-minute hold per transaction.
create table if not exists coupon_holds (
  txn_id      text primary key,
  coupon_id   uuid not null,
  email       text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 minutes'
);
create index if not exists coupon_holds_coupon_idx on coupon_holds (coupon_id, expires_at);
alter table coupon_holds enable row level security;   -- service role only

create or replace function reserve_coupon(p_coupon_id uuid, p_txn_id text, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_max int; v_used int; v_holds int;
begin
  -- serialize per coupon
  perform pg_advisory_xact_lock(hashtext(p_coupon_id::text));
  delete from coupon_holds where expires_at < now();
  select max_redemptions, coalesce(redemption_count, 0) into v_max, v_used from coupons where id = p_coupon_id;
  if v_max is null then
    insert into coupon_holds (txn_id, coupon_id, email) values (p_txn_id, p_coupon_id, p_email) on conflict (txn_id) do nothing;
    return true;   -- uncapped coupon: always reservable
  end if;
  select count(*) into v_holds from coupon_holds where coupon_id = p_coupon_id and txn_id <> p_txn_id;
  if v_used + v_holds >= v_max then return false; end if;
  insert into coupon_holds (txn_id, coupon_id, email) values (p_txn_id, p_coupon_id, p_email) on conflict (txn_id) do nothing;
  return true;
end $$;
revoke execute on function reserve_coupon(uuid, text, text) from public, anon, authenticated;

-- (F9) Webhook concurrent-delivery race: two deliveries of the same event with
-- processed_at still null could both run the fulfilment. processing_at is an
-- atomic claim (stale after 5 min so a crashed attempt can be retried).
alter table webhook_events add column if not exists processing_at timestamptz;

create or replace function claim_webhook_event(p_event_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update webhook_events set processing_at = now()
   where provider = 'paddle' and event_id = p_event_id and processed_at is null
     and (processing_at is null or processing_at < now() - interval '5 minutes')
  returning id into v_id;
  return v_id is not null;
end $$;
revoke execute on function claim_webhook_event(text) from public, anon, authenticated;
