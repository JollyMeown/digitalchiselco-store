-- 063: campaign attribution for marketing pushes.
-- Every outbound link in the marketing roadmap carries ?src=<campaign-tag>
-- (e.g. ?src=reddit-cnc, ?src=printables). The pageview beacon forwards it and
-- site_visits records it, so Admin -> Traffic can rank campaigns by real
-- visitors — no more guessing which community actually converts.
alter table public.site_visits add column if not exists campaign text;
create index if not exists site_visits_campaign_idx on public.site_visits (campaign) where campaign is not null;
