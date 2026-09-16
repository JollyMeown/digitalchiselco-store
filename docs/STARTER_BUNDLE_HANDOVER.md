# Starter Bundle: what BRS must send the website

The starter bundle is the one-off pack sold for **$6.99** through the emailed
offer at `/starter`. It is **not** a membership month. It exists so the offer
can be made without giving away a pack that paying members bought
(owner rule, 2026-09-16: "this September pack is also used by paid members, so
do not send to paid members").

BRS builds it once. The website then serves it forever, to anyone who buys the
starter plan, with no further work.

## Where it goes

The same table and the same upsert the monthly pack builder already uses:

```
POST /rest/v1/monthly_files?on_conflict=month
```

with **`month` set to the sentinel `0001-01`**. That value can never collide
with a real pack month, and the membership engine routes every starter term to
it (`STARTER_PACK_MONTH` in `src/lib/subscriptions.ts`).

## The fields

| field | value |
|---|---|
| `month` | `0001-01` exactly. This is what makes it the starter bundle. |
| `title` | `Starter Bundle` (shown on the page and in the email) |
| `file_count` | `6` |
| `items` | 6 entries of `{title, slug, image_url}`, same shape as a monthly pack |
| `cover_image_url` | grid cover, uploaded to `site-media/membership/starter/cover.jpg` |
| `standard_drive_link` | **the branded download PDF**, not the zip. The website refuses to offer the bundle until this is set. |
| `admin_zip_link` | the zip with pictures plus PDF, admin only |
| `built_by` | `brs` |
| `bonus_drive_link` | leave empty. The starter has no bonus tier. |

## Which six designs

Pick for breadth, not for rank. The bundle is a demonstration of what the
catalogue can do, seen by someone who has bought little or nothing.

- Six different subject areas. Wildlife, faith, western, floral, pets and
  patriotic cover most of what sells.
- Mid-tier sellers, **not** the shop's top organic sellers. Those earn on their
  own and do not need giving away.
- Nothing already inside a Premium bundle, and nothing in the five free files.
- Every file link-checked, the same as a monthly pack.

## Why six, and why $6.99

The ladder has to reward commitment, so the starter must cost **more per
design** than the plan above it:

| | designs | price | per design |
|---|---|---|---|
| Free pack | 5 | $0.00 | - |
| **Starter bundle** | **6** | **$6.99** | **$1.17** |
| 3-month | 24 | $24.99 | $1.04 |
| 6-month | 48 | $39.99 | $0.83 |
| 12-month Premium | 96 | $69.99 | $0.73 |

Six is one more than the five free files, so it reads as a real step up, and
two fewer than a member month, so members keep the better deal. At $6.99 it
clears the payment fee (about $0.85) and still reads as a trial. Change the
count or the price and this table must still fall from top to bottom.

## After BRS uploads

Nothing. `/starter` and `scripts/membership/starter_offer.mjs` both read the
row live. The offer script refuses to send while `standard_drive_link` is
empty, so a half-built bundle can never be sold.
