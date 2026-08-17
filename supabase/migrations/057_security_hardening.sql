-- Security hardening from the 2026-08-17 audit. Each block closes one verified
-- hole; none change what the storefront or admin panel legitimately do.

-- (1) reviews: the original permissive policy (005) was never dropped when
-- moderation + reviewer email arrived (039). Policies OR together, so anon could
-- read PENDING reviews and every reviewer's EMAIL. Keep only approved+active,
-- and take the email column away from anon entirely.
drop policy if exists "public read reviews" on reviews;
revoke select (email) on reviews from anon;

-- (2) design_requests: public board leaked submitter emails.
revoke select (email) on design_requests from anon, authenticated;

-- (3) profiles: "update own profile" had no column restriction, so any
-- authenticated user could set is_admin=true on their own row (latent — needs a
-- profile row + open signups, but one config change from critical).
revoke update (is_admin) on profiles from authenticated;

-- (4) rate-limit RPCs are SECURITY DEFINER and were callable by anon: anyone
-- could pre-fill a victim's bucket (lock them out of sign-in / subscribe /
-- checkout) or spam rate_limit_hits. Server (service_role) keeps access.
revoke execute on function rate_limit_check(text, int, int) from public, anon, authenticated;
revoke execute on function rate_limit_gc() from public, anon, authenticated;

-- (5) admin_link_review view: definer semantics + default grants exposed every
-- product (incl. drafts) + link status to anon.
do $$ begin
  if exists (select 1 from information_schema.views where table_name = 'admin_link_review') then
    execute 'alter view admin_link_review set (security_invoker = true)';
    execute 'revoke all on admin_link_review from anon, authenticated';
  end if;
end $$;

-- (6) is_admin(): pin search_path (defence in depth for a security definer fn).
do $$ begin
  if exists (select 1 from pg_proc where proname = 'is_admin') then
    execute 'alter function is_admin() set search_path = public';
  end if;
end $$;
