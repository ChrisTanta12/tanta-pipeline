/**
 * One-shot historical backfill of the swap_rates table from RBNZ B2.
 *
 * RBNZ's daily-close XLSX contains every business day going back to 1985.
 * The daily scraper only writes the latest row, so the table starts off
 * empty for historical lookups. This script walks every row and upserts
 * them in a single batch so the calculator's "wholesale rate when client
 * fixed" lookup has data to query.
 *
 * Usage (run from the office PC, same machine as scrape:swap-rates):
 *   npm run backfill:swap-rates
 *
 * Idempotent: re-running just refreshes any existing rows. Safe to run
 * multiple times. Takes ~30s for ~10,500 rows.
 *
 * Required env (load via .env.local):
 *   POSTGRES_URL  # Neon connection string
 */
import { sql } from '@vercel/postgres';
import { scrapeAllSwapRates } from '../app/lib/scrapers/swapRates';

const BATCH_SIZE = 500;

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not set (is .env.local loaded?)');
  }

  console.log('[backfill] downloading RBNZ B2 daily close…');
  const { source, rows, warnings } = await scrapeAllSwapRates();
  console.log(`[backfill] parsed ${rows.length} rows`);
  console.log(`[backfill] earliest: ${rows[0].observationDate}, latest: ${rows[rows.length - 1].observationDate}`);
  if (warnings.length > 0) console.log('[backfill] warnings:', warnings);

  await sql`
    CREATE TABLE IF NOT EXISTS swap_rates (
      observation_date  DATE PRIMARY KEY,
      rates             JSONB NOT NULL,
      source            TEXT NOT NULL,
      fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // Build a single multi-row INSERT for this batch via VALUES expansion.
    // @vercel/postgres doesn't accept arrays directly into a single SQL
    // template, so we run each row separately within the batch but parallelise
    // them with Promise.all — Neon handles 500 concurrent statements fine.
    await Promise.all(
      batch.map((r) =>
        sql`
          INSERT INTO swap_rates (observation_date, rates, source, fetched_at)
          VALUES (${r.observationDate}::date, ${JSON.stringify(r.rates)}::jsonb, ${source}, NOW())
          ON CONFLICT (observation_date) DO UPDATE
            SET rates = EXCLUDED.rates,
                source = EXCLUDED.source,
                fetched_at = NOW()
        `,
      ),
    );
    written += batch.length;
    console.log(`[backfill] ${written}/${rows.length} rows upserted`);
  }

  console.log(`[backfill] done — ${written} rows now in swap_rates`);
}

main().catch((err) => {
  console.error('[backfill] failed:', err.message);
  process.exit(1);
});
