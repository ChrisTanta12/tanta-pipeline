/**
 * RBNZ swap rates scraper — runs on the office PC, NOT on Vercel.
 *
 * RBNZ's edge rejects requests from Vercel/AWS datacenter IPs with 403.
 * Local fetches from a residential IP go through fine, so we run the
 * scraper from the office PC (same machine that runs trail-sync) and
 * push the latest observation into the swap_rates table on Neon.
 * The /api/swap-rates Vercel route then reads from Postgres.
 *
 * Usage:
 *   npm run scrape:swap-rates
 *
 * Designed to be invoked by Windows Task Scheduler daily at ~08:30 NZST,
 * after the next-business-day RBNZ data becomes available. See
 * scripts/scrape-swap-rates.vbs for a hidden-window launcher.
 *
 * Required env (load via .env.local):
 *   POSTGRES_URL  # Neon connection string
 */
import { sql } from '@vercel/postgres';
import { scrapeSwapRates } from '../app/lib/scrapers/swapRates';

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not set (is .env.local loaded?)');
  }

  console.log('[scrape:swap-rates] fetching RBNZ B2 daily close…');
  const snap = await scrapeSwapRates();

  if (!snap.observationDate) {
    throw new Error('No observation date parsed');
  }
  const numericRates: Record<string, number> = {};
  for (const [k, v] of Object.entries(snap.rates)) {
    if (typeof v === 'number') numericRates[k] = v;
  }
  if (Object.keys(numericRates).length === 0) {
    throw new Error('No rates parsed');
  }

  console.log(
    `[scrape:swap-rates] observation ${snap.observationDate}, terms ${Object.keys(numericRates).join(', ')}`,
  );

  // Auto-create on first run so a fresh deploy doesn't 500 before migrate.
  await sql`
    CREATE TABLE IF NOT EXISTS swap_rates (
      observation_date  DATE PRIMARY KEY,
      rates             JSONB NOT NULL,
      source            TEXT NOT NULL,
      fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    INSERT INTO swap_rates (observation_date, rates, source, fetched_at)
    VALUES (${snap.observationDate}::date, ${JSON.stringify(numericRates)}::jsonb, ${snap.source}, NOW())
    ON CONFLICT (observation_date) DO UPDATE
      SET rates = EXCLUDED.rates,
          source = EXCLUDED.source,
          fetched_at = NOW()
  `;

  console.log('[scrape:swap-rates] upsert complete');
  if (snap.warnings.length > 0) {
    console.log('[scrape:swap-rates] warnings:', snap.warnings);
  }
}

main().catch((err) => {
  console.error('[scrape:swap-rates] failed:', err.message);
  process.exit(1);
});
