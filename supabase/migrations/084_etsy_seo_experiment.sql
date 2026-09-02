-- Etsy SEO rewrite experiment: which weak listings (views < 20, zero sales)
-- got a new title + tags, what they had before (revert data), and the views /
-- favorers / sales at the moment of the change, so growth can be compared
-- against the untouched weak listings after a week or two.
create table if not exists public.etsy_seo_experiment (
  listing_id bigint primary key,
  applied_at timestamptz not null default now(),
  batch text not null,
  old_title text,
  old_tags text[],
  new_title text,
  new_tags text[],
  views_at_apply integer not null default 0,
  favorers_at_apply integer not null default 0,
  sales_at_apply integer not null default 0,
  status text not null default 'applied',   -- applied | reverted | error
  note text
);
create index if not exists etsy_seo_exp_batch_idx on public.etsy_seo_experiment (batch, applied_at desc);

alter table public.etsy_seo_experiment enable row level security;
do $$ begin
  execute 'drop policy if exists etsy_seo_exp_admin on public.etsy_seo_experiment';
  execute 'create policy etsy_seo_exp_admin on public.etsy_seo_experiment for select to authenticated using (public.is_admin())';
end $$;
revoke all on public.etsy_seo_experiment from anon;
