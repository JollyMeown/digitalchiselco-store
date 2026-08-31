-- 070: Cut Local marketplace — Phase 2 (the buyer loop + maker ratings).
-- Gated by growth_settings.marketplace_enabled (default false) so the buyer
-- "Make it real" button stays hidden until launch.
alter table public.growth_settings add column if not exists marketplace_enabled boolean not null default false;

-- Maker economy + reputation (added to the makers table from migration 069).
alter table public.makers
  add column if not exists credits integer not null default 5,       -- founding starter credits
  add column if not exists rating_avg numeric(3,2) not null default 0,
  add column if not exists rating_count integer not null default 0,
  add column if not exists jobs_completed integer not null default 0;

-- A buyer's request to have a design made (RFQ).
create table if not exists public.maker_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'open',        -- open | awarded | completed | cancelled
  buyer_email text not null,
  buyer_name text,
  product_id uuid, product_slug text, product_title text, product_image text,
  material text, size text, finish text, quantity integer default 1,
  deadline text, budget text, notes text,
  delivery text,                              -- pickup | ship | either
  country text, region text, city text, postal text,
  awarded_maker_id uuid references public.makers(id),
  awarded_at timestamptz, completed_at timestamptz,
  agreed_price numeric(10,2)
);
create index if not exists maker_requests_status_idx on public.maker_requests (status, created_at desc);
create index if not exists maker_requests_buyer_idx on public.maker_requests (lower(buyer_email));

-- A maker's quote on a request.
create table if not exists public.maker_quotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_id uuid not null references public.maker_requests(id) on delete cascade,
  maker_id uuid not null references public.makers(id),
  price numeric(10,2) not null,
  lead_days integer,
  message text,
  status text not null default 'submitted',   -- submitted | won | lost | withdrawn
  unique (request_id, maker_id)
);
create index if not exists maker_quotes_req_idx on public.maker_quotes (request_id);
create index if not exists maker_quotes_maker_idx on public.maker_quotes (maker_id);

-- Chat between a buyer and the makers on a request.
create table if not exists public.maker_messages (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  request_id uuid not null references public.maker_requests(id) on delete cascade,
  maker_id uuid references public.makers(id),   -- which maker thread
  sender text not null,                         -- buyer | maker
  body text,
  attachments text[] not null default '{}'
);
create index if not exists maker_messages_thread_idx on public.maker_messages (request_id, maker_id, id);

-- Star ratings a buyer leaves after a completed job → maker reputation.
create table if not exists public.maker_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_id uuid not null references public.maker_requests(id) on delete cascade,
  maker_id uuid not null references public.makers(id),
  buyer_email text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  unique (request_id)
);
create index if not exists maker_reviews_maker_idx on public.maker_reviews (maker_id, created_at desc);

-- Credit + fee ledger (quote spends a credit; completion records the 3% fee owed).
create table if not exists public.maker_ledger (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  maker_id uuid not null references public.makers(id),
  kind text not null,               -- quote_spend | credit_grant | success_fee
  credits_delta integer default 0,
  amount_usd numeric(10,2) default 0,
  request_id uuid,
  note text
);

-- Recompute a maker's rating aggregate whenever a review lands.
create or replace function public.recompute_maker_rating(p_maker uuid)
returns void language sql security definer set search_path = public as $$
  update public.makers m set
    rating_avg = coalesce((select round(avg(rating)::numeric, 2) from public.maker_reviews where maker_id = p_maker), 0),
    rating_count = coalesce((select count(*) from public.maker_reviews where maker_id = p_maker), 0)
  where m.id = p_maker;
$$;

-- All these tables are driven by token-authenticated SSR routes using the
-- service role; browsers never read them directly. Lock out anon; admin reads.
alter table public.maker_requests enable row level security;
alter table public.maker_quotes  enable row level security;
alter table public.maker_messages enable row level security;
alter table public.maker_reviews enable row level security;
alter table public.maker_ledger  enable row level security;
do $$ begin
  perform 1;
  execute 'drop policy if exists mp_req_admin on public.maker_requests';
  execute 'create policy mp_req_admin on public.maker_requests for select to authenticated using (public.is_admin())';
  execute 'drop policy if exists mp_q_admin on public.maker_quotes';
  execute 'create policy mp_q_admin on public.maker_quotes for select to authenticated using (public.is_admin())';
  execute 'drop policy if exists mp_m_admin on public.maker_messages';
  execute 'create policy mp_m_admin on public.maker_messages for select to authenticated using (public.is_admin())';
  execute 'drop policy if exists mp_rv_admin on public.maker_reviews';
  execute 'create policy mp_rv_admin on public.maker_reviews for select to authenticated using (public.is_admin())';
  execute 'drop policy if exists mp_lg_admin on public.maker_ledger';
  execute 'create policy mp_lg_admin on public.maker_ledger for select to authenticated using (public.is_admin())';
end $$;
revoke all on public.maker_requests, public.maker_quotes, public.maker_messages, public.maker_reviews, public.maker_ledger from anon;
