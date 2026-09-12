# Google Shopping: what to advertise, at what price, and when to stop

Written 2026-09-12 from the shop's own numbers, not from general advice. Every
figure here can be re-derived from the database.

## The one fact that decides everything

A click is paid for out of a single sale's margin. At the site's measured
conversion of **1.72%** (1,395 unique visitors, 24 orders, 30 days) and Paddle's
cut of about **7.8%**, the most a click can be worth is `price x 0.922 x 0.0172`:

| Product price | Most a click can be worth |
|---|---|
| $6.39 | $0.10 |
| $7.99 | $0.13 |
| $10.39 | $0.17 |
| $12.00 | $0.19 |
| $16.00 | $0.25 |
| $18.39 | $0.29 |
| $31.99 bundle | $0.51 |
| $55.99 bundle | $0.89 |
| $75.00 bundle | $1.19 |

Google Shopping clicks in this niche cost **$0.20 to $0.60**. So advertising a
$6 design loses money on arithmetic alone, no matter how good the listing is.
**Only the expensive end of the catalogue can be advertised at all**, and that
is the whole strategy in one line.

## What sells, so you know what is worth defending

5,472 Etsy sales in 365 days across 1,725 live designs, and they are not evenly
spread:

| Tier | Products | Share of all sales |
|---|---|---|
| A, 10 or more sales | 138 | **54%** |
| B, 3 to 9 sales | 400 | 36% |
| C, 1 to 2 sales | 366 | 10% |
| D, never sold | 821 | 0% |

Eight percent of the catalogue carries over half the business. By category,
**Religious and Christian** leads on revenue ($12,342 a year from 220 designs),
then Wildlife ($6,479), Fish and Fly Fishing ($3,180).

Higher prices earn far more per listing: the 164 designs at $12 and over make
$85 each per year, while the 1,409 at $5 to $8 make $17 each. The expensive end
is both more profitable per sale AND the only part that can carry ad costs.

## The campaigns

Two Standard Shopping campaigns. **Not Performance Max**: it spreads spend
across YouTube, Gmail and Display without showing where the money went, and at a
$16.91 average order that opacity is unaffordable.

### Campaign 1 — Bundles
- Filter: `custom_label_3 = bundle`
- Why first: a $31.99 bundle can pay $0.51 a click, a $75 one $1.19. These are
  the only products with real headroom above the market click price.
- Budget: **$6/day**, max CPC **$0.45**
- The Cabin and Lodge Wildlife Bundle ($31.99, 34 sales a year) is the single
  best candidate in the catalogue: proven demand and margin to spend.

### Campaign 2 — Proven $16+ singles
- Filter: `custom_label_2 = bid_yes`
- 19 designs, almost all religious, every one already selling on Etsy
- Budget: **$4/day**, max CPC **$0.25**
- Leaders: Face of Christ and Crucifixion ($16, 80 sales), Crucifixion at
  Calvary ($18.39, 52), The Last Supper ($18.39, 51), Jesus Reaching Hand
  ($16, 51)

### Everything else — excluded
1,668 of 1,710 items are marked `bid_no`. They stay in the feed for free
listings, which cost nothing, and are never bid on.

## Settings, exactly

- Campaign type: **Shopping > Standard**, inventory filter on the custom label
- Bidding: **Manual CPC**, so the ceiling is yours and not Google's to raise.
  Switch to Maximise clicks with a CPC cap only once 30 or more conversions have
  been recorded
- Countries: **United States, United Kingdom, Canada, Australia**. Your buyers
  are English-speaking woodworkers; broad targeting buys cheap useless clicks
- Devices: start with all, then cut mobile bids if its conversion lags after two
  weeks. A 100 MB STL is a desktop purchase
- Total budget: **$10/day, $300 for a 30-day test**
- Negative keywords (Shopping accepts them and they matter): *free, gratis,
  torrent, crack, download free, dxf, svg, vector, laser only, g-code*

## How to judge it, and when to stop

The test succeeds at **20 or more sales from $300**. That is roughly $0.27 a
click converting at 2%, slightly better than the site average, which is a fair
expectation for traffic that searched for exactly this.

Check at these points and act:

| When | Read | Act |
|---|---|---|
| Day 3 | clicks and cost per click | if CPC is above $0.45, lower the cap; do not raise the budget |
| Day 7 | conversions | 0 conversions on 100+ clicks means the offer is not landing: pause and reconsider |
| Day 14 | cost per conversion | above $15.59 you are paying more than the order is worth: cut the losers |
| Day 30 | total sales | below 20, stop the campaign |

**The standing comparison:** Etsy ads currently return about **$115 of profit per
day on $27 of spend**. Google has to beat that for the same money, or the money
belongs on Etsy. Do not run both budgets up at once; the Etsy review on
23 September comes first.

## The labels in the feed

Every item now carries five, so a campaign can be steered without editing
products by hand:

| Label | Meaning | Values |
|---|---|---|
| `custom_label_0` | how well it sells | `A_best`, `B_proven`, `C_slow`, `D_unsold` |
| `custom_label_1` | price band | `price_30_plus` … `price_under_8` |
| `custom_label_2` | **biddable** | `bid_yes` (19), `bid_test` (23), `bid_no` (1,668) |
| `custom_label_3` | kind | `bundle` (11), `single` |
| `custom_label_4` | the ceiling | `max_cpc_0.51`, and so on |

`bid_yes` means it can afford $0.25 a click and has already sold 3 or more times.
`bid_test` can afford the click but has no sales record yet, mostly new bundles:
worth a small, capped trial once the first campaign is proving itself.

These recompute on every feed fetch, so a design that starts selling promotes
itself into the biddable group without anyone remembering to do it.

## How to stop the spending

The website cannot do it. Pausing a campaign needs the Google Ads API and a
developer token that Google approves separately, so the admin panel links to the
right screens instead of pretending to control them.

**To pause, in two clicks:** [ads.google.com/aw/campaigns](https://ads.google.com/aw/campaigns),
click the coloured status dot beside the campaign name, choose **Pause**. Green
means running, grey means paused. It stops within minutes.

Other useful screens, all under account **574-282-1599**:

| What | Where |
|---|---|
| Pause, resume, see today's spend | https://ads.google.com/aw/campaigns |
| Change a daily budget | https://ads.google.com/aw/campaigns/settings |
| Billing, payment method, invoices | https://ads.google.com/aw/billing/summary |
| What Google claims it converted | https://ads.google.com/aw/conversions |

**The blunt instrument**, if something is badly wrong and you cannot get into the
campaign screens: remove the payment method under Billing. Google stops serving
when it cannot charge. Use it only in an emergency, since re-adding it starts a
new billing cycle.

All four links are also in Admin > Advertising, at the top of the Google
Shopping panel, beside the numbers that would make you want them.
