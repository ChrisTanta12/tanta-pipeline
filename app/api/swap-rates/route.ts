import { NextRequest, NextResponse } from 'next/server';
import { getLatestSwapRates, getSwapRatesForDate } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Public read endpoint for swap rate observations. Wholesale swap rates are
 * public market data (sourced from RBNZ B2 daily close), so no auth.
 *
 * - GET /api/swap-rates              → latest observation (today / yesterday)
 * - GET /api/swap-rates?date=YYYY-MM-DD → that date's row, or the most
 *   recent earlier row if the exact date isn't present (weekend, holiday).
 *   Used by the break fee calculator to fetch "wholesale rate when client
 *   fixed" given the fix-end-date and original term.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date — expected YYYY-MM-DD' },
        { status: 400 },
      );
    }
    const row = await getSwapRatesForDate(date);
    if (!row) {
      return NextResponse.json(
        { error: `No swap rates on or before ${date} — backfill may not have run yet` },
        { status: 404 },
      );
    }
    return NextResponse.json(row);
  }

  const latest = await getLatestSwapRates();
  if (!latest) {
    return NextResponse.json(
      { error: 'No swap rates stored yet — cron has not run' },
      { status: 404 },
    );
  }
  return NextResponse.json(latest);
}
