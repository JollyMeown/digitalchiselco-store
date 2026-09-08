-- The advertising budget becomes a managed cycle rather than a one-off number
-- (owner 2026-09-09: "tell me what budget you keep and when, then monitor,
-- then suggest, and keep logging to get a pattern").
--
-- The cycle is: PROPOSE a budget with a review date -> the owner sets it in
-- Etsy and logs it -> the days that follow are measured against the days
-- before -> the verdict is written back onto the same row. After a few cycles
-- the log itself is the pattern, so recommendations stop being one reading of
-- one window and start being this shop's own history of what each level did.

alter table public.ad_budget_log add column if not exists review_on date;
-- 'owner' when the owner changed it, 'claude' when it was taken from the
-- dashboard recommendation. Lets the log show whose calls worked out.
alter table public.ad_budget_log add column if not exists source text not null default 'owner';
-- What the number was expected to do, written when it is set, so the review is
-- judged against the prediction rather than against hindsight.
alter table public.ad_budget_log add column if not exists expectation text;
-- Filled in at review time: {days, revPerDay, adPerDay, profitPerDay, margin,
-- adShare, vsPrevious{...}, verdict}. Kept on the row so a period's result
-- survives even after finance_daily is re-synced.
alter table public.ad_budget_log add column if not exists outcome jsonb;
alter table public.ad_budget_log add column if not exists reviewed_at timestamptz;

create index if not exists ad_budget_log_review_idx on public.ad_budget_log (review_on) where reviewed_at is null;

-- Backfill the two historical entries: the $45 period ran its course long ago,
-- the $20 cut is the live one and comes due after a fortnight of trading.
update public.ad_budget_log set review_on = (changed_at + interval '14 days')::date
 where review_on is null;

-- Every scheduled look at the numbers, whether or not the budget changed. A
-- review that says "hold" is evidence too, and without it the log would only
-- ever record changes and never the decisions to leave things alone.
create table if not exists public.ad_reviews (
  id bigserial primary key,
  reviewed_at timestamptz not null default now(),
  budget_id bigint references public.ad_budget_log(id) on delete set null,
  window_days integer not null default 14,
  rev_per_day numeric(10,2),
  ad_per_day numeric(10,2),
  profit_per_day numeric(10,2),
  margin numeric(6,2),
  ad_share numeric(6,2),
  recommended numeric(10,2),
  action text,                      -- 'hold' | 'raise' | 'cut'
  note text,
  next_review date
);
create index if not exists ad_reviews_at_idx on public.ad_reviews (reviewed_at desc);
alter table public.ad_reviews enable row level security;
drop policy if exists "ad_reviews_admin" on public.ad_reviews;
create policy "ad_reviews_admin" on public.ad_reviews for all using (is_admin()) with check (is_admin());
