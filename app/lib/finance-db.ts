/**
 * DB helpers for the /finance route. Reads cycles, config, capital movements
 * from Postgres. All writes happen via scripts (npm run finance:seed,
 * future finance:ingest) — the web app is read-only at this stage so we
 * can iterate safely while the pattern beds in.
 */
import { sql } from '@vercel/postgres';
import type {
  CycleRow,
  FinanceConfig,
  CapitalMovement,
  IncomeBySource,
  Allocations,
  OpexByCategory,
  AccountBalances,
  CycleFlag,
  Taps,
  AccountMap,
  CapitalMovementKind,
} from './finance-types';

/** Coerce NUMERIC (which @vercel/postgres returns as string) to number. */
function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

type CycleDbRow = {
  cycle_end_date: string;
  cycle_start_date: string;
  quarter: string;
  trading_income_cash: string;
  trading_income_earned: string;
  trail_income: string;
  upfront_income: string;
  income_by_source: IncomeBySource;
  allocations_prescribed: Allocations;
  allocations_actual: Allocations;
  true_opex: string;
  opex_by_category: OpexByCategory;
  drawings_chris: string;
  drawings_anthony: string;
  account_balances_end: AccountBalances;
  flags: CycleFlag[];
  notes: string | null;
};

function rowToCycle(r: CycleDbRow): CycleRow {
  return {
    cycleEndDate: isoDate(r.cycle_end_date),
    cycleStartDate: isoDate(r.cycle_start_date),
    quarter: r.quarter,
    tradingIncomeCash: num(r.trading_income_cash),
    tradingIncomeEarned: num(r.trading_income_earned),
    trailIncome: num(r.trail_income),
    upfrontIncome: num(r.upfront_income),
    incomeBySource: r.income_by_source ?? {},
    allocationsPrescribed: r.allocations_prescribed ?? { opex: 0, salaries: 0, tax: 0, profit: 0 },
    allocationsActual: r.allocations_actual ?? { opex: 0, salaries: 0, tax: 0, profit: 0 },
    trueOpex: num(r.true_opex),
    opexByCategory: r.opex_by_category ?? {},
    drawingsChris: num(r.drawings_chris),
    drawingsAnthony: num(r.drawings_anthony),
    accountBalancesEnd: r.account_balances_end ?? {},
    flags: Array.isArray(r.flags) ? r.flags : [],
    notes: r.notes,
  };
}

export async function getRecentCycles(limit = 13): Promise<CycleRow[]> {
  const { rows } = await sql<CycleDbRow>`
    SELECT
      cycle_end_date::text          AS cycle_end_date,
      cycle_start_date::text        AS cycle_start_date,
      quarter,
      trading_income_cash,
      trading_income_earned,
      trail_income,
      upfront_income,
      income_by_source,
      allocations_prescribed,
      allocations_actual,
      true_opex,
      opex_by_category,
      drawings_chris,
      drawings_anthony,
      account_balances_end,
      flags,
      notes
    FROM finance_cycles
    ORDER BY cycle_end_date DESC
    LIMIT ${limit}
  `;
  return rows.map(rowToCycle);
}

export async function getCyclesForQuarter(quarter: string): Promise<CycleRow[]> {
  const { rows } = await sql<CycleDbRow>`
    SELECT
      cycle_end_date::text          AS cycle_end_date,
      cycle_start_date::text        AS cycle_start_date,
      quarter,
      trading_income_cash,
      trading_income_earned,
      trail_income,
      upfront_income,
      income_by_source,
      allocations_prescribed,
      allocations_actual,
      true_opex,
      opex_by_category,
      drawings_chris,
      drawings_anthony,
      account_balances_end,
      flags,
      notes
    FROM finance_cycles
    WHERE quarter = ${quarter}
    ORDER BY cycle_end_date ASC
  `;
  return rows.map(rowToCycle);
}

export async function getCurrentConfig(): Promise<FinanceConfig | null> {
  const { rows } = await sql<{
    id: number;
    effective_from: string;
    effective_to: string | null;
    taps: Taps;
    account_map: AccountMap;
    notes: string | null;
  }>`
    SELECT
      id,
      effective_from::text          AS effective_from,
      effective_to::text            AS effective_to,
      taps,
      account_map,
      notes
    FROM finance_config
    WHERE effective_to IS NULL
    ORDER BY effective_from DESC
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    taps: r.taps,
    accountMap: r.account_map,
    notes: r.notes,
  };
}

export async function getCapitalMovementsRecent(limit = 50): Promise<CapitalMovement[]> {
  const { rows } = await sql<{
    id: number;
    movement_date: string;
    cycle_end_date: string | null;
    kind: CapitalMovementKind;
    amount: string;
    description: string | null;
    payee_or_payer: string | null;
    notes: string | null;
  }>`
    SELECT
      id,
      movement_date::text           AS movement_date,
      cycle_end_date::text          AS cycle_end_date,
      kind,
      amount,
      description,
      payee_or_payer,
      notes
    FROM finance_capital_movements
    ORDER BY movement_date DESC
    LIMIT ${limit}
  `;
  return rows.map(r => ({
    id: r.id,
    movementDate: r.movement_date,
    cycleEndDate: r.cycle_end_date,
    kind: r.kind,
    amount: num(r.amount),
    description: r.description,
    payeeOrPayer: r.payee_or_payer,
    notes: r.notes,
  }));
}

/** Aggregates over the most recent N cycles for the snapshot file. */
export async function computeHistoryAggregates(cycles: CycleRow[]) {
  const last3 = cycles.slice(0, 3);   // assumes input is DESC-sorted (most recent first)
  const last6 = cycles.slice(0, 6);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // 3-month rolling figures (~6 fortnights)
  const trail3 = avg(last6.map(c => c.trailIncome));
  const trail6 = avg(cycles.slice(0, 13).map(c => c.trailIncome));
  const tradingIncome3 = avg(last6.map(c => c.tradingIncomeCash));
  const trueOpex3 = avg(last6.map(c => c.trueOpex));
  const drawings3 = avg(last6.map(c => c.drawingsChris + c.drawingsAnthony));

  // Last quarter summary — most recent quarter where we have ≥4 cycles to make the % meaningful
  const byQuarter = new Map<string, CycleRow[]>();
  for (const c of cycles) {
    if (!byQuarter.has(c.quarter)) byQuarter.set(c.quarter, []);
    byQuarter.get(c.quarter)!.push(c);
  }
  let lastQuarter: { quarter: string; trading_income: number; trail_pct: number; true_opex_pct: number; drawings_pct: number; } = {
    quarter: '',
    trading_income: 0,
    trail_pct: 0,
    true_opex_pct: 0,
    drawings_pct: 0,
  };
  const sortedQs = [...byQuarter.keys()].sort().reverse();
  for (const q of sortedQs) {
    const qcycles = byQuarter.get(q)!;
    if (qcycles.length >= 4) {
      const ti = qcycles.reduce((a, c) => a + c.tradingIncomeCash, 0);
      const tr = qcycles.reduce((a, c) => a + c.trailIncome, 0);
      const op = qcycles.reduce((a, c) => a + c.trueOpex, 0);
      const dr = qcycles.reduce((a, c) => a + c.drawingsChris + c.drawingsAnthony, 0);
      lastQuarter = {
        quarter: q,
        trading_income: ti,
        trail_pct: ti > 0 ? tr / ti : 0,
        true_opex_pct: ti > 0 ? op / ti : 0,
        drawings_pct: ti > 0 ? dr / ti : 0,
      };
      break;
    }
  }

  return {
    trail_floor_3mo: trail3 * 26 / 12,    // monthly equivalent of fortnightly avg
    trail_floor_6mo: trail6 * 26 / 12,
    trading_income_3mo_avg: tradingIncome3 * 26 / 12,
    true_opex_3mo_avg: trueOpex3 * 26 / 12,
    drawings_3mo_avg: drawings3 * 26 / 12,
    last_quarter_summary: lastQuarter,
  };
}
