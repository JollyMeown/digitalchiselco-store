-- 061: Cults3D sale alerts + a persisted owner-alert feed.
--
-- cults_sales   : every Cults3D sale, keyed by Cults' own sale id, so a poller
--                 can tell NEW sales from ones already seen (and alert once).
-- owner_alerts  : the dashboard's live alert feed (all channels). The admin
--                 chime listener subscribes to INSERTs here (realtime) and
--                 polls it as a fallback, so a Cults sale rings the admin just
--                 like a website order does.
-- poll_status   : heartbeat for the 10-minute Cults poller (System health).

create table if not exists public.cults_sales (
  id            text primary key,              -- Cults sale id (opaque)
  sold_at       timestamptz not null,
  product_name  text,
  slug          text,
  url           text,
  country_name  text,
  country_code  text,
  income        numeric(10,2) not null default 0,
  currency      text not null default 'EUR',
  payed_out_at  timestamptz,
  seen_at       timestamptz not null default now(),
  alerted_at    timestamptz,                   -- null = alert still owed
  raw           jsonb
);
create index if not exists cults_sales_sold_at_idx on public.cults_sales (sold_at desc);

create table if not exists public.owner_alerts (
  id          bigserial primary key,
  kind        text not null,                   -- 'cults_sale' | 'website_order' | ...
  title       text not null,
  body        text,
  amount      numeric(10,2),
  currency    text,
  url         text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists owner_alerts_created_idx on public.owner_alerts (created_at desc);

create table if not exists public.poll_status (
  key      text primary key,
  ran_at   timestamptz not null default now(),
  ok       boolean not null default true,
  note     text,
  runner   text
);

-- RLS: admin read-only from the browser; all writes come from service_role.
alter table public.cults_sales  enable row level security;
alter table public.owner_alerts enable row level security;
alter table public.poll_status  enable row level security;
drop policy if exists cults_sales_admin_read  on public.cults_sales;
drop policy if exists owner_alerts_admin_read on public.owner_alerts;
drop policy if exists poll_status_admin_read  on public.poll_status;
create policy cults_sales_admin_read  on public.cults_sales  for select to authenticated using (public.is_admin());
create policy owner_alerts_admin_read on public.owner_alerts for select to authenticated using (public.is_admin());
create policy poll_status_admin_read  on public.poll_status  for select to authenticated using (public.is_admin());
revoke all on public.cults_sales, public.owner_alerts, public.poll_status from anon;

-- Realtime: let the admin chime listener hear owner_alerts INSERTs live
-- (same mechanism migration 012 used for orders).
do $$
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    begin
      execute 'alter publication supabase_realtime add table public.owner_alerts';
    exception when duplicate_object then null;
    end;
  end if;
end $$;
