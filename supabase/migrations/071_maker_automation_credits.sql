-- 071: maker automation flags + credit purchases (Cut Local Phase 2 finish).
alter table public.growth_settings add column if not exists maker_automations_enabled boolean not null default false;
alter table public.makers
  add column if not exists welcomed_at timestamptz,           -- welcome-on-approval sent
  add column if not exists jobs_nudged_at timestamptz,        -- last "jobs waiting" nudge
  add column if not exists low_credit_nudged_at timestamptz;  -- last low-credit reminder

-- Credit-pack purchases via Paddle. The webhook grants credits from THIS
-- trusted row (keyed by Paddle txn id), never from forgeable custom_data.
create table if not exists public.maker_credit_purchases (
  txn_id text primary key,
  created_at timestamptz not null default now(),
  maker_id uuid not null references public.makers(id),
  credits integer not null,
  amount_usd numeric(10,2) not null,
  pack text,
  status text not null default 'pending',   -- pending | granted
  granted_at timestamptz
);
alter table public.maker_credit_purchases enable row level security;
drop policy if exists mcp_admin on public.maker_credit_purchases;
create policy mcp_admin on public.maker_credit_purchases for select to authenticated using (public.is_admin());
revoke all on public.maker_credit_purchases from anon;
