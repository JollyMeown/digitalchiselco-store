-- All-Access Library pass (2026-09-25).
--
-- A 12-month membership plan that, on top of the usual monthly member pack,
-- lets the holder add ANY design in the library to their account while the
-- term is active (fair use: a cap per 30 days, enforced in lib/all-access.ts).
-- It rides the existing membership engine (purchase, renewal, upgrade,
-- expiry, monthly pack), so the only new data is:
--   * the plan row, created HIDDEN (available_from 2099-01-01) until the owner
--     reviews it at /membership?preview=1 and sets the launch date;
--   * entitlements.source, so a design added with the pass is told apart from
--     one that was bought (fair-use count, account page section).
-- No new table, so no new Data API grants are needed.

alter table public.entitlements add column if not exists source text;
create index if not exists entitlements_email_source_idx on public.entitlements (email, source, granted_at);

insert into public.membership_plans (slug, name, months, files_per_month, price_usd, features, active, sort_order, highlight, available_from)
values (
  'all-access-year',
  'All-Access Library Pass, 12 months',
  12, 8, 149,
  '["Personal and small-shop commercial licence: sell what you carve", "Add designs to your account from any product page, download any time"]'::jsonb,
  true, 90, false, '2099-01-01'
)
on conflict (slug) do nothing;
