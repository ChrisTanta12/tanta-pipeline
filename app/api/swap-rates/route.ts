import { NextResponse } from 'next/server';
import { getLatestSwapRates } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Public read endpoint for the most recent swap rate observation. Powers the
 * "use latest" button on the break fee calculator. No auth — wholesale swap
 * rates are public market data published by interest.co.nz.
 */
export async function GET() {
  const latest = await getLatestSwapRates();
  if (!latest) {
    return NextResponse.json(
      { error: 'No swap rates stored yet — cron has not run' },
      { status: 404 },
    );
  }
  return NextResponse.json(latest);
}
