-- 068: make the "best time to send" histogram engagement-aware.
--
-- Why: raw pageviews lie. A 00:00-01:00 ET spike (228 visits, 146 product
-- views, clustered on 9 days) produced ZERO cart adds — scraper-like traffic —
-- while 09:00-10:00 ET produced 8 cart adds from far fewer visits. Ranking by
-- visits alone would have scheduled the daily send for 1 AM.
--
-- So the RPC now also returns `actions`: buying-intent events (add_to_cart,
-- buy_now, wishlist_add, checkout_start) from the SAME US visitors, bucketed
-- in the requested timezone. The admin graph shows both series and ranks by
-- intent, falling back to visitors only when intent data is still too sparse.
-- Postgres cannot change a function's return type in place.
drop function if exists public.us_visit_hours(int, text);
create function public.us_visit_hours(p_days int default 30, p_tz text default 'America/New_York')
returns table (hour int, visitors int, visits int, actions int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(730, p_days)));
begin
  if not public.is_admin() then
    return;
  end if;
  return query
  with us as (
    select v.ts, v.visitor_hash
    from public.site_visits v
    where v.country = 'US' and v.ts >= v_since and coalesce(v.device, '') <> 'bot'
  ),
  vis as (
    select date_part('hour', ts at time zone p_tz)::int as h,
           count(distinct visitor_hash)::int as visitors,
           count(*)::int as visits
    from us group by 1
  ),
  act as (
    select date_part('hour', e.ts at time zone p_tz)::int as h, count(*)::int as actions
    from public.site_events e
    where e.ts >= v_since
      and e.type in ('add_to_cart', 'buy_now', 'wishlist_add', 'checkout_start')
      and exists (select 1 from us where us.visitor_hash = e.visitor_hash)
    group by 1
  ),
  hours as (select generate_series(0, 23) as h)
  select hours.h,
         coalesce(vis.visitors, 0),
         coalesce(vis.visits, 0),
         coalesce(act.actions, 0)
  from hours
  left join vis on vis.h = hours.h
  left join act on act.h = hours.h
  order by hours.h;
end;
$$;

revoke execute on function public.us_visit_hours(int, text) from public, anon;
grant execute on function public.us_visit_hours(int, text) to authenticated;
