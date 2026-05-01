/**
 * Seeds the finance_* tables with the Q1 2026 baseline analysed in
 * Tanta-Finance/reports/2026-Q1-7cycle-review.html.
 *
 * Idempotent: uses ON CONFLICT for cycles, deletes & re-inserts config and
 * capital movements. Safe to re-run as the cycle figures get refined.
 *
 * Usage: npm run finance:seed
 */
import { sql } from '@vercel/postgres';

type Allocations = { opex: number; salaries: number; tax: number; profit: number };

type Cycle = {
  cycleEndDate: string;
  cycleStartDate: string;
  quarter: string;
  tradingIncomeCash: number;
  tradingIncomeEarned: number;
  trailIncome: number;
  upfrontIncome: number;
  incomeBySource: Record<string, Record<string, number>>;
  allocationsPrescribed: Allocations;
  allocationsActual: Allocations;
  trueOpex: number;
  opexByCategory: Record<string, number>;
  drawingsChris: number;
  drawingsAnthony: number;
  accountBalancesEnd: Record<string, number>;
  flags: Array<{ severity: 'ok' | 'warn' | 'bad'; title: string; body: string }>;
  notes: string | null;
};

// =====================================================
// Q1 2026 cycles — derived from real bank statement + KAN + SHL analysis
// (see Tanta-Finance/reports/ for full traceability)
// =====================================================
const CYCLES: Cycle[] = [
  {
    cycleEndDate: '2026-01-14',
    cycleStartDate: '2026-01-01',
    quarter: '2026Q1',
    tradingIncomeCash: 19827.21,
    tradingIncomeEarned: 19827.21,
    trailIncome: 9281.69,
    upfrontIncome: 10545.52,
    incomeBySource: {
      KAN: { trail: 4661.42, upfront: 5874.82 },
      SHL: { trail: 4645.82 },
      Booster: { trail: 4420.57 },
      Generate: { trail: 137.91 },
      FidLife: { upfront: 54.89 },
      Chubb: { upfront: 31.02 },
      Pathfinder: { trail: 76.65 },
      NZFunds: { trail: 0.49 },
      Milford: { trail: 548.47 },
    },
    allocationsPrescribed: { opex: 9075.07, salaries: 8169.61, tax: 793.09, profit: 396.54 },
    allocationsActual: { opex: 9076.30, salaries: 8168.67, tax: 726.08, profit: 181.53 },
    trueOpex: 6708.75,
    opexByCategory: {
      Trail: 2415.00, GoCardlessOther: 397.95, GST: 871.89, Bookkeeping: 635.38,
      SaaS: 720.43, Telco: 279.74, Utilities: 154.02, Vehicle: 1532.44, BankFees: 5.00,
    },
    drawingsChris: 5700.00,
    drawingsAnthony: 5700.00,
    accountBalancesEnd: {},
    flags: [
      { severity: 'warn', title: 'TAP execution drift', body: 'Bank rules at 50/45/4/1, sheet TAPs at 49/45/4/2. Profit short ~$215.' },
    ],
    notes: 'First cycle of 2026.',
  },
  {
    cycleEndDate: '2026-01-28',
    cycleStartDate: '2026-01-15',
    quarter: '2026Q1',
    tradingIncomeCash: 30731.88,
    tradingIncomeEarned: 30731.88,
    trailIncome: 8527.56,
    upfrontIncome: 22204.32,
    incomeBySource: {
      KAN: { trail: 4084.05, upfront: 14266.23 },
      SHL: { upfront: 3916.20 },
      AJG: { upfront: 5873.40 },
      Milford: { trail: 0 },
      Pathfinder: { trail: 76.65 },
      Chubb: { upfront: 132.07 },
      FidLife: { upfront: 53.16 },
      AIA: { upfront: 553.74 },
    },
    allocationsPrescribed: { opex: 11618.41, salaries: 10671.36, tax: 948.52, profit: 474.26 },
    allocationsActual: { opex: 11856.52, salaries: 10670.87, tax: 948.52, profit: 237.13 },
    trueOpex: 10246.04,
    opexByCategory: {
      Rent: 3092.40, PIInsurance: 1098.55, SaaS: 2531.46, Marketing: 2519.19,
      Telco: 279.74, Hiring: 799.25, BankFees: 5.00,
    },
    drawingsChris: 9500.00,
    drawingsAnthony: 9500.00,
    accountBalancesEnd: {},
    flags: [
      { severity: 'warn', title: 'Double drawings round', body: 'Two rounds of personal drawings hit this cycle (20/01 + 28/01). Total $19k, larger than usual $11k.' },
    ],
    notes: 'Includes Luke contractor portion paid separately ($9,012.37 to Payroll). Excluded from PF allocation base.',
  },
  {
    cycleEndDate: '2026-02-11',
    cycleStartDate: '2026-01-29',
    quarter: '2026Q1',
    tradingIncomeCash: 28974.84,
    tradingIncomeEarned: 28974.84,
    trailIncome: 14071.93,
    upfrontIncome: 14902.91,
    incomeBySource: {
      KAN: { trail: 4257.54, upfront: 4483.88 },
      SHL: { trail: 4655.71, upfront: 10182.00 },
      Booster: { trail: 4483.88 },
      Generate: { trail: 140.03 },
      FidLife: { upfront: 54.97 },
      Chubb: { upfront: 163.09 },
    },
    allocationsPrescribed: { opex: 14101.07, salaries: 12950.78, tax: 1151.18, profit: 575.51 },
    allocationsActual: { opex: 14388.85, salaries: 12949.96, tax: 1151.11, profit: 287.78 },
    trueOpex: 3320.43,
    opexByCategory: {
      Trail: 2415.00, GoCardlessOther: 397.95, SaaS: 459.13, BankFees: 5.00, Meals: 52.40,
    },
    drawingsChris: 5500.00,
    drawingsAnthony: 5500.00,
    accountBalancesEnd: {},
    flags: [],
    notes: 'Strong cycle. SHL Riahi settlement upfront $10,182. Reserve top-up $4,385 made 12/02.',
  },
  {
    cycleEndDate: '2026-02-25',
    cycleStartDate: '2026-02-12',
    quarter: '2026Q1',
    tradingIncomeCash: 909.26,
    tradingIncomeEarned: 909.26,
    trailIncome: 829.70,
    upfrontIncome: 79.56,
    incomeBySource: {
      KAN: { trail: 238.85 },
      Milford: { trail: 508.15 },
      FidLife: { upfront: 53.16 },
      Pathfinder: { trail: 68.62 },
      Other: { other: 40.48 },
    },
    allocationsPrescribed: { opex: 0, salaries: 0, tax: 0, profit: 0 },
    allocationsActual: { opex: 0, salaries: 0, tax: 0, profit: 0 },
    trueOpex: 5546.00,
    opexByCategory: {
      Rent: 3092.40, PIInsurance: 1098.56, SaaS: 1300.00, BankFees: 5.00,
    },
    drawingsChris: 5500.00,
    drawingsAnthony: 5500.00,
    accountBalancesEnd: {},
    flags: [
      { severity: 'warn', title: 'Genuinely low-income cycle', body: 'Trading income only $909 — no PF transfers made. Halo asset sale $12,750 came in on 17/02 (capital, not income) and proceeds went directly to CC for Lean Marketing.' },
    ],
    notes: 'Halo book-purchase channelled directly to CC. See capital movements.',
  },
  {
    cycleEndDate: '2026-03-11',
    cycleStartDate: '2026-02-26',
    quarter: '2026Q1',
    tradingIncomeCash: 26778.62,
    tradingIncomeEarned: 26778.62,
    trailIncome: 11023.78,
    upfrontIncome: 15754.84,
    incomeBySource: {
      KAN: { trail: 4110.00, upfront: 13381.89 },
      SHL: { trail: 4759.76, upfront: 282.00 },
      Booster: { trail: 4014.77 },
      Generate: { trail: 118.20 },
      Chubb: { upfront: 112.00 },
    },
    allocationsPrescribed: { opex: 10161.43, salaries: 9332.04, tax: 829.50, profit: 414.75 },
    allocationsActual: { opex: 10368.81, salaries: 9331.93, tax: 829.50, profit: 207.38 },
    trueOpex: 4134.97,
    opexByCategory: {
      Trail: 1506.70, GoCardlessOther: 397.95, BoLi: 311.88, AffordX: 64.63,
      SaaS: 1245.05, Equipment: 670.40, BankFees: 5.00,
    },
    drawingsChris: 5500.00,
    drawingsAnthony: 5500.00,
    accountBalancesEnd: {},
    flags: [],
    notes: '$721.59 GST topup paid to IRD. $5,319 retained as buffer (used next cycle).',
  },
  {
    cycleEndDate: '2026-04-08',
    cycleStartDate: '2026-03-26',
    quarter: '2026Q2',
    tradingIncomeCash: 22736.54,
    tradingIncomeEarned: 22736.54,
    trailIncome: 13093.04,
    upfrontIncome: 9643.50,
    incomeBySource: {
      KAN: { trail: 7589.08, upfront: 9337.25 },
      Booster: { trail: 4356.76 },
      Chubb: { upfront: 63.92 },
      Lendy: { upfront: 400.00 },
      SHL: { upfront: 4954.53 },
      Other: { trail: 1147.20 },
    },
    allocationsPrescribed: { opex: 11140.90, salaries: 10231.44, tax: 909.46, profit: 454.73 },
    allocationsActual: { opex: 11368.27, salaries: 10231.44, tax: 909.46, profit: 227.37 },
    trueOpex: 3217.27,
    opexByCategory: {
      Trail: 1725.00, GoCardlessOther: 397.95, AffordX: 51.52,
      SaaS: 768.92, Marketing: 206.94, BankFees: 5.00, Vehicle: 54.00,
    },
    drawingsChris: 6137.00,
    drawingsAnthony: 6287.00,
    accountBalancesEnd: {},
    flags: [
      { severity: 'warn', title: 'Q2 first cycle — quarterly TAP review pending', body: 'First cycle of Q2 2026. The quarterly TAP review (alongside Q1 Profit Distribution) should be on the 22/04 catch-up agenda.' },
    ],
    notes: 'First cycle of Q2 2026. Larger drawings round ($5,637 each + expenses).',
  },
  {
    cycleEndDate: '2026-03-25',
    cycleStartDate: '2026-03-12',
    quarter: '2026Q1',
    tradingIncomeCash: 17857.45,
    tradingIncomeEarned: 17857.45,
    trailIncome: 8403.80,
    upfrontIncome: 9453.65,
    incomeBySource: {
      KAN: { trail: 0, upfront: 9696.50 },
      SHL: { upfront: 1392.00 },
      Milford: { trail: 471.94 },
      Chubb: { upfront: 90.05 },
      Pathfinder: { trail: 62.11 },
    },
    allocationsPrescribed: { opex: 8750.15, salaries: 8035.85, tax: 714.30, profit: 357.15 },
    allocationsActual: { opex: 8928.73, salaries: 8028.56, tax: 0, profit: 178.57 },
    trueOpex: 4743.00,
    opexByCategory: {
      Rent: 3092.40, Networking: 600.00, SaaS: 1045.60, BankFees: 5.00,
    },
    drawingsChris: 5500.00,
    drawingsAnthony: 5500.00,
    accountBalancesEnd: {
      'Tanta Income': 18968.70,
      'Opex 8.1K': 7791.06,
      'Payroll 8K': 1661.19,
      'Chris Expenses': 31.32,
      'Ant Expenses': 805.35,
      'Expenses CC 3.5K': -2892.63,
      'New Hire 30K': 4408.68,
      'KiwiSaver': 5.71,
      'Profit (external)': 178.64,
      'Tax (external)': 6818.41,
    },
    flags: [
      { severity: 'warn', title: 'Non-standard cycle allocation', body: '"Shareholder allocation remainder" of $8,028.56 used instead of separate Tax/Salaries lines. Buffer from prior cycle covered the maths.' },
    ],
    notes: 'Last cycle of Q1. Used the $5,319 buffer carried from 11/03.',
  },
];

// =====================================================
// Config (TAPs) — Q1 2026
// =====================================================
const CONFIG = {
  effectiveFrom: '2026-01-01',
  effectiveTo: null as string | null,
  taps: { opex: 0.49, salaries: 0.45, tax: 0.04, profit: 0.02 },
  accountMap: {
    'Tanta Income': 'collection',
    'Opex 8.1K': 'opex',
    'Payroll 8K': 'salaries (dormant)',
    'Chris Expenses': 'opex (Chris personal)',
    'Ant Expenses': 'opex (Anthony personal)',
    'Expenses CC 3.5K': 'opex (CC vehicle)',
    'New Hire 30K': 'strategic reserve (outside PF)',
    'KiwiSaver': 'placeholder',
    'Profit (external)': 'profit',
    'Tax (external)': 'tax',
  },
  notes: 'Q1 2026 TAPs. Bank rules currently 50/45/4/1; sheet TAPs 49/45/4/2 — drift to be resolved at quarterly TAP review. Drawings split 50/50 between Chris and Anthony per locked policy 1 May 2026.',
};

// =====================================================
// Capital movements (separate from trading income)
// =====================================================
const CAPITAL = [
  {
    movementDate: '2026-02-17',
    cycleEndDate: '2026-02-25' as string | null,
    kind: 'asset_sale',
    amount: 12750.00,
    description: 'Halo Advisers — book of clients sold (asset sale, NOT trading income)',
    payeeOrPayer: 'HALO ADVISERS L',
    notes: 'Proceeds redeployed to Lean Marketing $11,900 via CC top-up.',
  },
  {
    movementDate: '2026-01-28',
    cycleEndDate: '2026-01-28' as string | null,
    kind: 'contractor_passthrough',
    amount: -9012.37,
    description: 'Luke contractor portion (28/01)',
    payeeOrPayer: 'Payroll 8K → Luke',
    notes: 'Part of Luke wind-down. Three pieces total in Q1.',
  },
  {
    movementDate: '2026-02-25',
    cycleEndDate: '2026-02-25' as string | null,
    kind: 'contractor_passthrough',
    amount: -2340.33,
    description: 'Luke contractor portion (25/02)',
    payeeOrPayer: 'Payroll 8K → Luke',
    notes: 'Part of Luke wind-down.',
  },
  {
    movementDate: '2026-02-25',
    cycleEndDate: '2026-02-25' as string | null,
    kind: 'contractor_passthrough',
    amount: 5006.86,
    description: 'Aaron Cattell — Luke payout (returned to Tanta)',
    payeeOrPayer: 'MR A P BROWNE',
    notes: 'Part of Luke wind-down. Net Luke outflow ≈ −$6,346.',
  },
  {
    movementDate: '2026-02-12',
    cycleEndDate: '2026-02-11' as string | null,
    kind: 'reserve_topup',
    amount: 4385.07,
    description: 'New Hire 30K reserve top-up',
    payeeOrPayer: 'Opex 8.1K → New Hire 30K',
    notes: 'Only reserve top-up in Q1. Authorised to be more frequent (~$1.5k/cycle from Opex headroom).',
  },
];

async function main() {
  console.log('Seeding finance_config...');
  // Close out any existing currently-effective config and insert ours.
  await sql`UPDATE finance_config SET effective_to = ${CONFIG.effectiveFrom}::date - 1 WHERE effective_to IS NULL`;
  await sql`
    INSERT INTO finance_config (effective_from, effective_to, taps, account_map, notes)
    VALUES (
      ${CONFIG.effectiveFrom}::date,
      ${CONFIG.effectiveTo}::date,
      ${JSON.stringify(CONFIG.taps)}::jsonb,
      ${JSON.stringify(CONFIG.accountMap)}::jsonb,
      ${CONFIG.notes}
    )
  `;

  console.log('Seeding finance_cycles...');
  for (const c of CYCLES) {
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
    process.stdout.write(`  ✓ ${c.cycleEndDate} ($${c.tradingIncomeCash.toFixed(2)})\n`);
  }

  console.log('Seeding finance_capital_movements...');
  // Clear and re-insert (small list, idempotent)
  await sql`DELETE FROM finance_capital_movements WHERE movement_date >= '2026-01-01' AND movement_date < '2026-04-01'`;
  for (const m of CAPITAL) {
    await sql`
      INSERT INTO finance_capital_movements (
        movement_date, cycle_end_date, kind, amount, description, payee_or_payer, notes
      ) VALUES (
        ${m.movementDate}::date,
        ${m.cycleEndDate}::date,
        ${m.kind},
        ${m.amount},
        ${m.description},
        ${m.payeeOrPayer},
        ${m.notes}
      )
    `;
    process.stdout.write(`  ✓ ${m.movementDate} ${m.kind} $${m.amount.toFixed(2)}\n`);
  }

  console.log('\n✓ Q1 2026 baseline seeded.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
