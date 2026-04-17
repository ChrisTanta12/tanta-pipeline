/**
 * Applies db/schema.sql against the Postgres pointed to by POSTGRES_URL.
 * Usage: npm run db:migrate
 * (Loads .env.local automatically via tsx --env-file)
 */
import { sql } from '@vercel/postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const schemaPath = join(process.cwd(), 'db', 'schema.sql');
  const raw = readFileSync(schemaPath, 'utf8');

  // Strip line comments so they don't swallow subsequent statements after split.
  const cleaned = raw
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleaned
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length > 0);

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
