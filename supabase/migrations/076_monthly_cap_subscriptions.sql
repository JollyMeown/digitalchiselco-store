-- 1. Monthly email cap: hard ceiling matching the Resend plan's monthly quota
--    (free = 3,000; Pro $20 = 50,000 with $0.90/1k overage). Marketing stops
--    at the cap; buyer-critical emails still send (tiny overage is cheaper
--    than a buyer without their files).
alter table public.growth_settings add column if not exists email_monthly_cap integer not null default 3000;

-- 2. Owner's subscription costs, shown + editable on the admin Finance tab.
--    [{name, monthly_usd, note}]
alter table public.growth_settings add column if not exists subscription_costs jsonb not null default '[]'::jsonb;
update public.growth_settings set subscription_costs = '[
  {"name": "Resend (email)", "monthly_usd": 0, "note": "Free tier: 3,000/mo, 100/day. Pro $20 = 50,000/mo, no daily cap"},
  {"name": "Netlify (hosting)", "monthly_usd": 0, "note": "Free tier"},
  {"name": "Supabase (database)", "monthly_usd": 0, "note": "Free tier"},
  {"name": "Domain digitalchiselco.com", "monthly_usd": 1, "note": "~$12/year"},
  {"name": "Paddle (payments)", "monthly_usd": 0, "note": "No fixed fee; 5% + $0.50 per transaction"}
]'::jsonb
where id = 1 and (subscription_costs is null or subscription_costs = '[]'::jsonb);
