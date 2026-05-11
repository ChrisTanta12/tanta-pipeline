/**
 * POST /api/finance-ingest/commit
 *
 * Body: the IngestPreview JSON returned by /api/finance-ingest/preview,
 *       optionally edited by the user. We upsert the cycleRow into
 *       finance_cycles using the same ON CONFLICT (cycle_end_date) pattern
 *       as scripts/seed-finance.ts.
 *
 * Returns: { ok: true, cycleEndDate } on success, or { error } otherwise.
 *
 * Auth-gated via isFinanceUnlocked().
 */
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { isFinanceUnlocked } from '@/app/lib/finance-auth';
import type { CycleRow } from '@/app/lib/finance-types';

export const runtime = 'nodejs';

function isCycleRow(v: unknown): v is CycleRow {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.cycleEndDate === 'string' &&
    typeof r.cycleStartDate === 'string' &&
    typeof r.quarter === 'string' &&
    typeof r.tradingIncomeCash === 'number' &&
    typeof r.allocationsPrescribed === 'object' &&
    typeof r.allocationsActual === 'object'
  );
}

export async function POST(req: NextRequest) {
  if (!isFinanceUnlocked()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'expected JSON body' }, { status: 400 }); }

  const cycleRow = (body as { cycleRow?: unknown })?.cycleRow;
  if (!isCycleRow(cycleRow)) {
    return NextResponse.json({ error: 'body.cycleRow missing or invalid' }, { status: 400 });
  }

  const c = cycleRow;
  try {
    await sql`
      INSERT INTO finance_cycles (
        cycle_end_date, cycle_start_date, quarter,
        trading_income_cash, trading_income_earned, trail_income, upfront_income,
        income_by_source,
        allocations_prescribed, allocations_actual,
        true_opex, opex_by_category,
        drawings_chris, drawings_anthony,
        account_balances_end, flags, notes
      ) VALUES (
        ${c.cycleEndDate}::date, ${c.cycleStartDate}::date, ${c.quarter},
        ${c.tradingIncomeCash}, ${c.tradingIncomeEarned}, ${c.trailIncome}, ${c.upfrontIncome},
        ${JSON.stringify(c.incomeBySource)}::jsonb,
        ${JSON.stringify(c.allocationsPrescribed)}::jsonb,
        ${JSON.stringify(c.allocationsActual)}::jsonb,
        ${c.trueOpex}, ${JSON.stringify(c.opexByCategory)}::jsonb,
        ${c.drawingsChris}, ${c.drawingsAnthony},
        ${JSON.stringify(c.accountBalancesEnd)}::jsonb,
        ${JSON.stringify(c.flags)}::jsonb,
        ${c.notes}
      )
      ON CONFLICT (cycle_end_date) DO UPDATE SET
        cycle_start_date = EXCLUDED.cycle_start_date,
        quarter = EXCLUDED.quarter,
        trading_income_cash = EXCLUDED.trading_income_cash,
        trading_income_earned = EXCLUDED.trading_income_earned,
        trail_income = EXCLUDED.trail_income,
        upfront_income = EXCLUDED.upfront_income,
        income_by_source = EXCLUDED.income_by_source,
        allocations_prescribed = EXCLUDED.allocations_prescribed,
        allocations_actual = EXCLUDED.allocations_actual,
        true_opex = EXCLUDED.true_opex,
        opex_by_category = EXCLUDED.opex_by_category,
        drawings_chris = EXCLUDED.drawings_chris,
        drawings_anthony = EXCLUDED.drawings_anthony,
        account_balances_end = EXCLUDED.account_balances_end,
        flags = EXCLUDED.flags,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `db error: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, cycleEndDate: c.cycleEndDate });
}
