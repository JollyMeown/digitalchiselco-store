-- 067: hourly US-visitor histogram for the admin "best time to send" graph.
--
-- Aggregates server-side (one row per hour) so the admin never pulls raw
-- site_visits — a year of traffic stays a 24-row response. Buckets are
-- computed IN the requested timezone, so the chart reads in the owner's
-- chosen US zone and daylight-saving is handled by Postgres.
--
-- SECURITY DEFINER to bypass site_visits RLS, with an explicit is_admin()
-- gate so only the owner can call it.
create or replace function public.us_visit_hours(p_days int default 30, p_tz text default 'America/New_York')
returns table (hour int, visitors int, visits int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
    select date_part('hour', v.ts at time zone p_tz)::int as hour,
           count(distinct v.visitor_hash)::int                as visitors,
           count(*)::int                                      as visits
    from public.site_visits v
    where v.country = 'US'
      and v.ts >= now() - make_interval(days => greatest(1, least(730, p_days)))
      and coalesce(v.device, '') <> 'bot'
    group by 1
    order by 1;
end;
$$;

revoke execute on function public.us_visit_hours(int, text) from public, anon;
grant execute on function public.us_visit_hours(int, text) to authenticated;
