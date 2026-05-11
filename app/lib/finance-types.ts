/**
 * Types for the /finance route.
 *
 * Mirrors the schema in db/schema.sql. Decimals come back from @vercel/postgres
 * as strings — coerce to number with parseFloat() when reading.
 *
 * See also: scripts/finance-snapshot.ts which serialises these into the
 * tanta_finance_snapshot.json that Cowork reads.
 */

export type IncomeSource =
  | 'KAN' | 'SHL' | 'Booster' | 'Milford' | 'Generate' | 'Pathfinder'
  | 'AJG' | 'Chubb' | 'AIA' | 'FidLife' | 'Lendy' | 'NZFunds' | 'Other';

export type IncomeBreakdown = {
  trail?: number;
  upfront?: number;
  refix?: number;
  clawback?: number;   // negative number
  other?: number;
};

export type IncomeBySource = Partial<Record<IncomeSource, IncomeBreakdown>>;

export type Allocations = {
  opex: number;
  salaries: number;
  tax: number;
  profit: number;
};

export type OpexByCategory = Partial<Record<
  | 'Rent' | 'PI insurance' | 'Trail (CRM)' | 'GoCardless other'
  | 'GST / IRD' | 'Bookkeeping' | 'Utilities' | 'SaaS'
  | 'Marketing' | 'Telco' | 'Vehicle' | 'Equipment'
  | 'Networking / events' | 'Bo Li'
  | 'DirectorExpenseFloat'    // $500-ish top-ups to Chris/Ant Expenses cards (opex, not drawings)
  | 'Other'
  , number
>>;

export type AccountBalances = Record<string, number>; // account name -> balance

export type CycleFlag = {
  severity: 'ok' | 'warn' | 'bad';
  title: string;
  body: string;
};

export type CycleRow = {
  cycleEndDate: string;          // ISO yyyy-mm-dd
  cycleStartDate: string;
  quarter: string;               // '2026Q1'
  tradingIncomeCash: number;
  tradingIncomeEarned: number;
  trailIncome: number;
  upfrontIncome: number;
  incomeBySource: IncomeBySource;
  allocationsPrescribed: Allocations;
  allocationsActual: Allocations;
  trueOpex: number;
  opexByCategory: OpexByCategory;
  drawingsChris: number;
  drawingsAnthony: number;
  accountBalancesEnd: AccountBalances;
  flags: CycleFlag[];
  notes: string | null;
};

export type Taps = {
  opex: number;     // 0..1, e.g. 0.49
  salaries: number;
  tax: number;
  profit: number;
};

export type AccountMap = Record<string, string>; // account name -> role

export type FinanceConfig = {
  id: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  taps: Taps;
  accountMap: AccountMap;
  notes: string | null;
};

export type CapitalMovementKind =
  | 'asset_sale'
  | 'asset_purchase'
  | 'contractor_passthrough'
  | 'reserve_topup'
  | 'reserve_drawdown'
  | 'loan_principal'
  | 'other';

export type CapitalMovement = {
  id: number;
  movementDate: string;
  cycleEndDate: string | null;
  kind: CapitalMovementKind;
  amount: number;
  description: string | null;
  payeeOrPayer: string | null;
  notes: string | null;
};

/**
 * The full snapshot shape exported to Drive for Cowork to read.
 * Keep this in sync with scripts/finance-snapshot.ts.
 */
export type FinanceSnapshot = {
  schema_version: '1.0.0';
  generated_at: string;          // ISO timestamp
  config: FinanceConfig;
  cycles: CycleRow[];            // most recent N — typically last 13 cycles (~6 months)
  capital_movements: CapitalMovement[];
  history_aggregates: {
    trail_floor_3mo: number;
    trail_floor_6mo: number;
    trading_income_3mo_avg: number;
    true_opex_3mo_avg: number;
    drawings_3mo_avg: number;
    last_quarter_summary: {
      quarter: string;
      trading_income: number;
      trail_pct: number;
      true_opex_pct: number;
      drawings_pct: number;
    };
  };
};
