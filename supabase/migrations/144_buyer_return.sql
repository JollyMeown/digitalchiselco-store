-- "You bought a wolf in July. Here are three more."
--
-- Measured 2026-09-22: 40 people have ever bought, 8 more than once, and the
-- median gap between two orders is 3 days with 4 of 10 on the same day. So
-- people buy twice in one sitting and then never return. Nobody who bought in
-- July or August came back in September.
--
-- The winback step does not cover this: it chases people who stopped OPENING
-- email, not people who bought once and drifted. A buyer is the warmest
-- audience there is, they already trusted us with a card, and they own a
-- machine that will want more files. This is the cheapest revenue available
-- and it currently does not exist.
create table if not exists public.buyer_return_log (
  email       text primary key,
  sent_at     timestamptz not null default now(),
  order_id    uuid,
  products    jsonb default '[]'::jsonb
);

alter table public.buyer_return_log enable row level security;
drop policy if exists buyer_return_log_admin on public.buyer_return_log;
create policy buyer_return_log_admin on public.buyer_return_log
  for all using (is_admin()) with check (is_admin());

-- Off until the owner turns it on, like every other sending step.
alter table public.growth_settings
  add column if not exists buyer_return_enabled boolean not null default false,
  add column if not exists buyer_return_days int not null default 30;

comment on column public.growth_settings.buyer_return_days is
  'Days after a buyer''s last order before the "more like what you bought" email.';
