// Create the "PREMIUM BUNDLE OFFER" category and attach every active bundle
// product to it. Skips subscription/membership products. Idempotent — safe to
// re-run.
import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const NAME = 'PREMIUM BUNDLE OFFER';
const SLUG = 'premium-bundle-offer';
const DESCRIPTION =
  '🔥 Premium Bundle Offer — our best-selling CNC bas-relief STL files, hand-picked into curated collections at a serious discount. Each bundle pairs 10+ premium designs in one click: thousands worth of carving inspiration for a fraction of the single-listing price. Christian faith, cowboy & western, hunting & fishing, pet memorial — every bundle is a complete starter library for makers who want to launch new product lines fast, fill a busy shop, or stock up before the next sale. Instant download, tested in Aspire / VCarve / Carveco / ArtCAM / Fusion 360 — and 50% of every bundle sale still goes to charity. Save big. Carve more. Give more.';

// 1) Upsert the category (with a high sort_order so it appears first)
const catRes = await c.query(
  `insert into categories (name, slug, description, sort_order)
   values ($1, $2, $3, -100)
   on conflict (slug) do update set
     name = excluded.name,
     description = excluded.description,
     sort_order = excluded.sort_order
   returning id, name, slug`,
  [NAME, SLUG, DESCRIPTION],
);
const cat = catRes.rows[0];
console.log('✓ category:', cat.name, '|', cat.id);

// 2) All active bundle products (skip membership/subscription)
const bundles = (await c.query(
  `select id, title, slug, is_subscription
     from products
    where is_bundle = true and active = true and coalesce(is_subscription, false) = false
    order by title`,
)).rows;
console.log(`\n→ Attaching ${bundles.length} bundles:`);

for (const b of bundles) {
  await c.query(
    `insert into product_categories (product_id, category_id)
     values ($1, $2)
     on conflict do nothing`,
    [b.id, cat.id],
  );
  console.log('  •', b.title.slice(0, 70));
}

// 3) Sanity check
const linked = (await c.query(
  `select count(*) n from product_categories pc
     join products p on p.id = pc.product_id
    where pc.category_id = $1 and p.is_bundle = true`,
  [cat.id],
)).rows[0].n;
console.log(`\n✓ ${linked} bundles linked to "${NAME}"`);

await c.end();
