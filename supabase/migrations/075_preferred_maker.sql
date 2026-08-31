-- Direct-request flow: a buyer who loves a maker's profile can send their
-- request straight to that maker (others still get notified for liquidity).
alter table public.maker_requests add column if not exists preferred_maker_id uuid references public.makers(id);
create index if not exists maker_requests_pref_idx on public.maker_requests (preferred_maker_id);
