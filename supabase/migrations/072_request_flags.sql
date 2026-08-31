-- 072: buyer/maker can report a problem on a request (dispute flow).
alter table public.maker_requests
  add column if not exists flagged boolean not null default false,
  add column if not exists flag_reason text,
  add column if not exists flagged_at timestamptz;
create index if not exists maker_requests_flagged_idx on public.maker_requests (flagged) where flagged = true;
