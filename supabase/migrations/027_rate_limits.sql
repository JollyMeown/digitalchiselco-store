-- Lightweight fixed-window rate limiting for unauthenticated endpoints
-- (sign-in-link email, subscribe, membership lead, checkout-init, coupon
-- validate). One row per attempt; the app counts rows in the window.
create table if not exists public.rate_limit_hits (
  id          bigint generated always as identity primary key,
  bucket      text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists rate_limit_hits_bucket_time
  on public.rate_limit_hits (bucket, created_at desc);

-- Server-only table: RLS on, no policies → the anon/public client can never
-- read or write it; the service-role client (API routes) bypasses RLS.
alter table public.rate_limit_hits enable row level security;

-- Atomic check-and-record: returns true if this attempt is allowed. Counts
-- hits for the bucket inside the window; if under the limit, records this hit.
-- SECURITY DEFINER so it runs with the table owner's rights.
create or replace function public.rate_limit_check(
  p_bucket text, p_max int, p_window_seconds int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  select count(*) into n
    from public.rate_limit_hits
   where bucket = p_bucket
     and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into public.rate_limit_hits (bucket) values (p_bucket);
  return true;
end;
$$;

-- Housekeeping: drop hits older than a day so the table stays small.
-- (Called opportunistically from the app; safe to run anytime.)
create or replace function public.rate_limit_gc() returns void
language sql security definer set search_path = public as $$
  delete from public.rate_limit_hits where created_at < now() - interval '1 day';
$$;
