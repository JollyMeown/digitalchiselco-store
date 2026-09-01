-- Track the rolling Cults3D tag/meta-tag refresh (20 listings per day).
alter table public.products add column if not exists cults3d_retagged_at timestamptz;
create index if not exists products_cults_retag_idx on public.products (cults3d_retagged_at) where cults3d_url is not null;
