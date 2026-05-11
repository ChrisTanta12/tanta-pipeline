/**
 * Types specific to the ingest pipeline. Distinct from finance-types.ts so we
 * can iterate on the preview shape without churning the canonical CycleRow.
 */
import type { CycleRow, IncomeSource } from '@/app/lib/finance-types';

/** A single classified bank-statement line item. */
export type BankLine = {
  date: string;             // ISO yyyy-mm-dd
  amount: number;           // signed: positive = inflow, negative = outflow
  payee: string;
  particulars: string;
  rawCategory: string;      // human-readable category from the classifier
  knownSource: IncomeSource | null;   // set when rawCategory maps to a known IncomeSource
  account: BankAccount;
};

export type BankAccount =
  | 'tanta_income'
  | 'opex_8_1k'
  | 'payroll_8k'
  | 'chris_expenses'
  | 'ant_expenses'
  | 'expenses_cc'
  | 'unknown';

/** A KAN xlsx export line (one per invoice). */
export type KanLine = {
  invoiceCode: string;
  provider: string;
  adviser: string;
  client: string;
  paymentDate: string;        // ISO
  loanAmount: number;
  commission: number;
  commissionType: 'Upfront' | 'Trail' | 'Other';
};

/** An SHL schedule line (either Trail-only or Grouped). */
export type ShlLine = {
  scheduleType: 'trail' | 'grouped';
  fileName: string;
  paymentDate: string | null;
  commissionType: 'UPFRONT' | 'TRAIL' | 'OTHER';
  amount: number;
};

export type FortnightWindow = {
  cycleStartDate: string;     // ISO yyyy-mm-dd, inclusive
  cycleEndDate: string;       // ISO yyyy-mm-dd, inclusive
  inferred: boolean;          // true if we picked it from prior cycle + 14d
};

export type IngestWarning = {
  severity: 'ok' | 'warn' | 'bad';
  title: string;
  body: string;
};

/**
 * Output of the preview pipeline — exactly the shape of a CycleRow plus a few
 * pieces of context (provenance, warnings, what was uploaded). The commit step
 * reads cycleRow and upserts into finance_cycles.
 */
export type IngestPreview = {
  window: FortnightWindow;
  cycleRow: CycleRow;
  warnings: IngestWarning[];
  suspectedCapital: {
    date: string;
    amount: number;
    payee: string;
    reason: string;
  }[];
  filesParsed: {
    bankCsvs: { account: BankAccount; fileName: string; lineCount: number }[];
    kanXlsx: { fileName: string; lineCount: number; inWindow: number } | null;
    shlCsvs: { fileName: string; scheduleType: 'trail' | 'grouped'; lineCount: number; inWindow: number }[];
  };
};
