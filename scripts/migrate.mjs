// Run a .sql migration file against the DB. Usage: node scripts/migrate.mjs supabase/migrations/xxx.sql
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/migrate.mjs <file.sql>'); process.exit(1); }
const sql = readFileSync(file, 'utf8');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(sql);
await c.end();
console.log('✓ applied', file);
