// Refresh products.rating_avg / rating_count from approved, active, product-linked
// reviews. Run daily (new Etsy + on-site reviews land continuously). Idempotent.
import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
// zero-out then set, so products whose reviews were removed/unapproved reset too
await c.query('update products set rating_avg = null, rating_count = 0 where rating_count > 0');
const res = await c.query(`
  update products p set rating_avg = agg.avg, rating_count = agg.cnt
  from (
    select product_id, round(avg(rating)::numeric, 1) as avg, count(*)::int as cnt
    from reviews
    where product_id is not null and status = 'approved' and active = true
    group by product_id
  ) agg
  where agg.product_id = p.id`);
await c.end();
console.log(`✓ ratings recomputed for ${res.rowCount} products`);
