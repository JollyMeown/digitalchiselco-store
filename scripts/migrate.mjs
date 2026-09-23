// Run a .sql migration file against the DB. Usage: node scripts/migrate.mjs supabase/migrations/xxx.sql
//
// Grant check. From 2026-10-30 Supabase stops granting Data API access to new
// tables in the public schema automatically. A table created without explicit
// grants is then unreachable through PostgREST, and that includes the
// service_role key every server route uses (supabaseAdmin), so the failure
// would show up as a permission-denied error in production, not here. Existing
// tables keep their grants; only NEW tables are affected.
//
// So this refuses any migration that creates a public table without granting
// it to service_role, and prints the statements to add. anon / authenticated
// are only needed when the browser client reads the table (keep RLS on).
// Rerunning an old migration that predates the rule: pass --no-grant-check.
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/migrate.mjs <file.sql> [--no-grant-check]'); process.exit(1); }
const sql = readFileSync(file, 'utf8');

if (!process.argv.includes('--no-grant-check')) {
  const code = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const created = [...code.matchAll(/create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)]
    .map((m) => m[1].toLowerCase());
  // a table in another schema (private.x) does not match, and needs no Data API grant
  const missing = [...new Set(created)].filter((t) => {
    const re = new RegExp(`grant\\s[^;]*\\bon\\s+(?:table\\s+)?(?:"?public"?\\.)?"?${t}"?\\b[^;]*\\bto\\b[^;]*\\bservice_role\\b`, 'i');
    return !re.test(code);
  });
  if (missing.length) {
    console.error(`✕ ${file} creates ${missing.length} public table(s) without a grant to service_role:`);
    for (const t of missing) {
      console.error(`\n  grant select, insert, update, delete on public.${t} to service_role;`);
      console.error(`  -- only if the browser (anon client) reads it, with RLS on:`);
      console.error(`  -- grant select on public.${t} to anon, authenticated;`);
    }
    console.error('\nAdd the grants to the migration (Supabase no longer adds them for new tables from 2026-10-30).');
    process.exit(1);
  }
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(sql);
await c.end();
console.log('✓ applied', file);
