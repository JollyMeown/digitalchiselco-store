-- Every published article can go out as an email: a one-off broadcast to the
-- list, and a drip that sends each subscriber every guide in turn. The email
-- renders from the post itself; these columns hold the per-post subject,
-- opener and inside photo the owner can edit in Admin > Automations.
alter table public.posts
  add column if not exists email_subject   text,
  add column if not exists email_intro     text,
  add column if not exists email_image_url text,
  add column if not exists email_in_drip   boolean not null default false;

alter table public.growth_settings
  add column if not exists article_drip_enabled  boolean not null default false,
  add column if not exists article_drip_gap_days integer not null default 4;

-- The finishing guide already went out (as guideCampaign / drip6); carry its
-- copy over so the generic sender shows the same email and never re-mails
-- anyone who had it.
update public.posts set
  email_subject   = 'How to finish a relief carving: the complete guide',
  email_intro     = 'Most relief carvings are lost after the machine finishes, not during the cut.' || E'\n\n' ||
                    'A carving is a landscape of very small hills and valleys, and the only reason anyone can see it is that light falls across it and leaves shadows. Fill those valleys with thick varnish and the whole thing goes flat. Keep them dark and the same board looks like it came out of a church.' || E'\n\n' ||
                    'We have just published the long version of how to do that, and there is one step that does most of the work. Flood the carving with a dark glaze, then wipe it back off the raised surfaces only. Here it is, half finished:',
  email_image_url = 'https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/site-media/blog/finishing/glaze-wipe.jpg',
  email_in_drip   = true
where slug = 'how-to-finish-cnc-relief-carvings';
