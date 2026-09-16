-- The starter month: a one-month membership used ONLY as an emailed offer.
--
-- Why it is hidden. The public ladder is 3 months $24.99 ($8.33/mo), 6 months
-- $39.99 ($6.67/mo), 12 months Premium $69.99 ($5.83/mo). Putting a cheap
-- single month on the pricing page would cannibalise the $24.99: a visitor who
-- would have paid $24.99 pays $4.99 instead, and 60% of them would have to
-- upgrade later just to break even on that swap.
--
-- So it is gated the same way Premium was before launch: `available_from` in
-- the future keeps it off the public picker (getMembershipPlans filters on it)
-- while checkout by the `membership:starter-month` cart marker still works.
-- It is therefore reachable ONLY through a link we email to a chosen segment,
-- and never to anyone who already has a term.
--
-- Price is $4.99 rather than free or $1 on purpose:
--   * free gives away the whole 8-design pack that 7 paying members bought,
--     and we already have a working free offer at the top of the funnel (the
--     5-file free pack, which converts at 13.2%);
--   * $1 does not cover the payment fee (~5% + $0.50), so each trial would
--     lose about $0.45;
--   * $4.99 clears the fee, still reads as a trial at 40% below the cheapest
--     monthly rate, and a completed checkout is the strongest predictor of
--     the next purchase.
-- It also stays ABOVE the $8.33/mo of the 3-month plan on a per-month basis
-- only in the sense that it buys one pack: the ladder still rewards commitment.

insert into membership_plans
  (slug, name, months, files_per_month, price_usd, original_price_usd,
   features, active, sort_order, highlight, available_from)
values
  ('starter-month',
   'Starter Month: 8 Bas-Relief STL Designs',
   1, 8, 4.99, 57,
   '["8 fresh bas-relief STL files, delivered straight away",
     "The same pack every paying member gets this month",
     "Commercial use included",
     "Upgrade any time and we credit what you paid",
     "No auto-renewal, nothing to cancel"]'::jsonb,
   true, 99, false,
   '2099-01-01')          -- far future = never on the public picker
on conflict (slug) do update set
  name = excluded.name,
  months = excluded.months,
  files_per_month = excluded.files_per_month,
  price_usd = excluded.price_usd,
  original_price_usd = excluded.original_price_usd,
  features = excluded.features,
  active = excluded.active,
  available_from = excluded.available_from;

comment on table membership_plans is
  'Membership plans. A row with available_from in the future is hidden from the public picker but still buyable by cart marker (membership:<slug>) - used for emailed-only offers such as starter-month.';
