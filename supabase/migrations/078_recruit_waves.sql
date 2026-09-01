-- Recruit invites become repeating WAVES: everyone gets re-invited with a
-- rotating subject every ~10 days until they apply as a maker (or unsubscribe).
alter table public.maker_invites add column if not exists last_sent_at timestamptz not null default now();
alter table public.maker_invites add column if not exists invite_count integer not null default 1;
update public.maker_invites set last_sent_at = invited_at where last_sent_at is null;
