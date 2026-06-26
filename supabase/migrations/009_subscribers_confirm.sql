-- Subscribe-confirmation columns. We now run the double opt-in loop ourselves
-- via Resend (MailerLite's API-created subscribers don't auto-receive a
-- confirmation email), then flip the MailerLite status to active after the
-- click so the existing Free STL Pack welcome automation can fire.

alter table subscribers
  add column if not exists name text,
  add column if not exists confirmed_at timestamptz;

create index if not exists subscribers_confirmed_at_idx on subscribers(confirmed_at);
