/**
 * Applies db/schema.sql against the Postgres pointed to by POSTGRES_URL.
 * Usage: POSTGRES_URL=... npm run db:migrate
 */
import { sql } from '@vercel/postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const schemaPath = join(process.cwd(), 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');

  const statements = schema
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    process.stdout.write(`→ ${stmt.split('\n')[0].slice(0, 80)}...\n`);
    await sql.query(stmt);
  }
  console.log(`\n✓ applied ${statements.length} statements`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
