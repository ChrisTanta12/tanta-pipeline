import { NextResponse } from 'next/server';
import { isFinanceUnlocked } from '@/app/lib/finance-auth';
import {
  getRecentCycles,
  getCurrentConfig,
  getCapitalMovementsRecent,
  computeHistoryAggregates,
} from '@/app/lib/finance-db';

export const dynamic = 'force-dynamic';

/**
 * Read-only endpoint for the /finance dashboard. Returns recent cycles,
 * current config (TAPs + account map), recent capital movements, and
 * pre-computed history aggregates.
 *
 * Auth: requires the tanta_finance cookie set by /api/finance-unlock.
 * Returns 401 otherwise.
 */
export async function GET() {
  if (!isFinanceUnlocked()) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const [cycles, config, capitalMovements] = await Promise.all([
      getRecentCycles(13),
      getCurrentConfig(),
      getCapitalMovementsRecent(50),
    ]);
    const historyAggregates = await computeHistoryAggregates(cycles);
    return NextResponse.json({
      cycles,
      config,
      capitalMovements,
      historyAggregates,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
