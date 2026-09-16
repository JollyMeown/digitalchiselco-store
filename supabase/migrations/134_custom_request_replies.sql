-- Replies sent to custom design requests from Admin > Custom Requests.
-- Owner, 2026-09-16: "how to send the reply?" The tab only had a mailto link
-- and private notes, so the owner's drafted quote had nowhere to go. The reply
-- is now sent from the site, and what was sent is kept on the request.
alter table public.custom_design_requests
  add column if not exists replied_at timestamptz,
  add column if not exists reply_body text,
  add column if not exists reply_count integer not null default 0;

comment on column public.custom_design_requests.reply_body is
  'The last reply the owner sent to the customer from the admin, exactly as sent.';
