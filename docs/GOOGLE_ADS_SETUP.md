# Google Ads: conversion tracking and the first campaign

The site now reports every purchase to Google. Analytics receives it already;
Google Ads starts receiving it the moment two environment variables exist.
Nothing here changes what a buyer sees.

## What is already working

On `/checkout/success` the page reads the order **from our own database** and
sends a `purchase` event with the real value, currency, transaction id and line
items. The value cannot be inflated by a tampered page, and the event only fires
once the Paddle webhook has written the order, which is the moment the sale is
certainly real.

A refresh, or a return visit from the confirmation email, is not counted twice:
the transaction id is the deduplication key, both locally and at Google's end.

## Turning on the Ads half

You need two values from a Google Ads account. Both are safe to publish: they
identify the account, they do not grant access to it.

1. Create the account at [ads.google.com](https://ads.google.com) with the same
   Google login as Merchant Center.
2. Link Merchant Center to it: Merchant Center > **Settings > Linked accounts >
   Google Ads**, then approve the request inside Google Ads. The feed is already
   eligible, 1,698 of 1,708 items, so nothing needs rebuilding.
3. In Google Ads: **Goals > Conversions > New conversion action > Website**.
   Enter `digitalchiselco.com`, then choose **Add a conversion action manually**.
   - Goal: **Purchase**
   - Value: **Use different values for each conversion** (the site sends the real one)
   - Count: **Every** conversion
   - Attribution: data-driven
4. Open the new action, choose **Use Google tag**, and copy the two values it
   shows you:
   - **Conversion ID**, looking like `AW-123456789`
   - **Conversion label**, looking like `AbC-D_efGhIjKlMn`
5. In Netlify: **Site configuration > Environment variables**, add
   - `PUBLIC_GOOGLE_ADS_ID` = the conversion ID
   - `PUBLIC_GOOGLE_ADS_PURCHASE_LABEL` = the conversion label
6. Redeploy. Both values are read at build time, so the deploy is what activates
   them.

To check it worked, install Google's **Tag Assistant** extension, open a
completed order page, and look for a `conversion` event carrying the order
total. Google also shows the action as "Recording conversions" within a day of
the first real sale.

## The first campaign, and why this shape

Standard Shopping, not Performance Max. Performance Max spreads spend across
YouTube, Gmail and Display and does not show where the money went; at an average
order of $16.91 that opacity is unaffordable. Standard Shopping runs on Search
and the Shopping tab, and lets you choose which products are advertised.

The numbers that decide everything, measured on 2026-09-12:

| | |
|---|---|
| Unique visitors, 30 days | 1,395 |
| Orders | 24 |
| Conversion rate | 1.72%, one sale per 58 visitors |
| Average order | $16.91 |
| Net after Paddle (~7.8%) | $15.59 |
| **Breakeven cost per click** | **$0.27** |

Shopping clicks in this niche usually cost $0.20 to $0.60, so the site sits at
or slightly below breakeven on average traffic. Ad traffic has to convert better
than an average visitor for this to pay, which is why the campaign should carry
proven sellers only, not all 1,698 designs.

Suggested test: **$10 per day for 30 days**, max CPC **$0.30**, proven sellers
only, English-speaking countries. Success is **20 or more sales** from that $300.
Below that, stop: Etsy ads currently return about $115 of profit per day on $27
of spend, and that is where the same money works harder.
