/**
 * Seeds the `banks` table from db/seed.json.
 * Safe to run repeatedly — uses UPSERT.
 * Usage: POSTGRES_URL=... npm run db:seed
 */
import { sql } from '@vercel/postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const seedPath = join(process.cwd(), 'db', 'seed.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as Record<string, { name: string } & Record<string, unknown>>;

  for (const [id, data] of Object.entries(seed)) {
    const { name, ...rest } = data;
    await sql`
      INSERT INTO banks (id, name, data, updated_at)
      VALUES (${id}, ${name}, ${JSON.stringify(rest)}::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            data = EXCLUDED.data,
            updated_at = NOW()
    `;
    console.log(`✓ seeded ${id}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
