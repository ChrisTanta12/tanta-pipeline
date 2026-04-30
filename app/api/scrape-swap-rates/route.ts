import { NextRequest, NextResponse } from 'next/server';
import { scrapeSwapRates } from '@/app/lib/scrapers/swapRates';
import { upsertSwapRates } from '@/app/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Cron endpoint. Scrapes interest.co.nz/charts/interest-rates/swap-rates daily
 * and writes the most recent observation row to the swap_rates table. Used by
 * the break fee calculator at /break-fee to auto-populate the wholesale rate.
 *
 * Auth: same Bearer-CRON_SECRET pattern as /api/scrape-interest.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const runAt = new Date().toISOString();
  let snap;
  try {
    snap = await scrapeSwapRates();
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Scrape failed', detail: err.message, runAt },
      { status: 502 },
    );
  }

  if (!snap.observationDate) {
    return NextResponse.json(
      { error: 'No observation date parsed', runAt, warnings: snap.warnings },
      { status: 502 },
    );
  }

  const numericRates: Record<string, number> = {};
  for (const [k, v] of Object.entries(snap.rates)) {
    if (typeof v === 'number') numericRates[k] = v;
  }

  if (Object.keys(numericRates).length === 0) {
    return NextResponse.json(
      { error: 'No rates parsed', runAt, warnings: snap.warnings },
      { status: 502 },
    );
  }

  await upsertSwapRates(snap.observationDate, numericRates, snap.source);

  return NextResponse.json({
    runAt,
    observationDate: snap.observationDate,
    termsStored: Object.keys(numericRates),
    warnings: snap.warnings,
  });
}
