-- Cut Local fee settlement: accrued 3% success fees are rolled into invoices
-- that makers pay through Paddle (same trusted-snapshot pattern as credits).
-- An overdue invoice blocks new quotes until paid.

create table if not exists public.maker_fee_invoices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  maker_id uuid not null references public.makers(id),
  amount_usd numeric(10,2) not null,
  status text not null default 'pending',    -- pending | paid | void
  txn_id text,                               -- Paddle transaction (set at checkout)
  due_at timestamptz not null default (now() + interval '14 days'),
  paid_at timestamptz,
  reminded_at timestamptz
);
create index if not exists maker_fee_invoices_maker_idx on public.maker_fee_invoices (maker_id, status);
create index if not exists maker_fee_invoices_txn_idx on public.maker_fee_invoices (txn_id);

-- Link ledger fee rows to the invoice that bills them (null = not yet invoiced).
alter table public.maker_ledger add column if not exists invoice_id uuid references public.maker_fee_invoices(id);

alter table public.maker_fee_invoices enable row level security;
do $$ begin
  execute 'drop policy if exists mp_fi_admin on public.maker_fee_invoices';
  execute 'create policy mp_fi_admin on public.maker_fee_invoices for select to authenticated using (public.is_admin())';
end $$;
revoke all on public.maker_fee_invoices from anon;
