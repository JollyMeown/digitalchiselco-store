// Seed the 3 bulk-discount promo codes + turn on the homepage announcement strip.
// Idempotent — re-runnable. Upserts by code.
import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const codes = [
  { code: '2026OFF15', percent_off: 15, min_items: 6,  description: 'Bulk 6+ items — 15% off' },
  { code: '2026OFF20', percent_off: 20, min_items: 10, description: 'Bulk 10+ items — 20% off' },
  { code: '2026OFF35', percent_off: 35, min_items: 25, description: 'Bulk 25+ items — 35% off' },
];

for (const x of codes) {
  // upsert by code
  await c.query(
    `insert into coupons (code, percent_off, min_items, description, active, scope)
     values ($1, $2, $3, $4, true, 'all')
     on conflict (code) do update set
       percent_off = excluded.percent_off,
       min_items   = excluded.min_items,
       description = excluded.description,
       active      = true,
       scope       = 'all',
       fixed_amount_off = null,
       min_subtotal     = null`,
    [x.code, x.percent_off, x.min_items, x.description],
  );
  console.log('  ✓', x.code);
}

// Turn on the homepage announcement with the exact copy
const announcement = [
  '✨ Wild Bulk Discount is LIVE! 🔥',
  '',
  'Save more when you buy more on my 3D models 🎉',
  '',
  '☑ 6 items → 15% OFF (Code: 2026OFF15)',
  '☑ 10 items → 20% OFF (Code: 2026OFF20)',
  '☑ 25 items → 35% OFF (Code: 2026OFF35)',
  '',
  'Add your items to cart and apply the promo code at checkout 🛒',
  '',
  '✨ Thank you for supporting my shop! 🖤',
].join('\n');

await c.query(
  `update site_settings set
     announcement_active = true,
     announcement_text = $1,
     announcement_link = '/catalog',
     announcement_cta_label = 'Shop the catalog'
   where id = 1`,
  [announcement],
);
console.log('  ✓ homepage announcement turned ON');

await c.end();
console.log('\nDone.');
