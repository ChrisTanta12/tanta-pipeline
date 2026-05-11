/**
 * Compose a CycleRow-shaped preview from parsed bank / KAN / SHL inputs.
 *
 * Inputs: parsed (already classified) lines from one or more bank statements,
 *         optional KAN xlsx lines, optional SHL CSV lines, optional window
 *         override.
 *
 * Output: a fortnight preview including the canonical CycleRow shape ready to
 *         upsert into finance_cycles, plus warnings + suspected capital
 *         pass-throughs for the user to review before commit.
 */
import type { CycleRow, IncomeBySource, IncomeBreakdown, Allocations, OpexByCategory, Taps } from '@/app/lib/finance-types';
import type { BankLine, KanLine, ShlLine, FortnightWindow, IngestPreview, IngestWarning } from './types';
import { kanInWindow, kanTotals } from './kan';
import { shlInWindow, shlTotals } from './shl';

/* ---------- Helpers ---------- */

function addToBreakdown(b: IncomeBreakdown, slot: keyof IncomeBreakdown, v: number) {
  b[slot] = (b[slot] ?? 0) + v;
}

function quarterFromDate(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}Q${Math.floor((m - 1) / 3) + 1}`;
}

/** Add 14 days to an ISO date and return ISO. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/* ---------- Window inference ---------- */

/**
 * Decide which fortnight we're previewing. Order of preference:
 *   1. explicit cycleEndDate override
 *   2. day-after the latest existing cycle in DB + 14 days (the "next" cycle)
 *   3. last date seen across bank lines (best-effort fallback)
 */
export function inferWindow(opts: {
  override?: { startIso?: string; endIso?: string };
  lastCycleEndIso?: string | null;
  bankLines: BankLine[];
}): FortnightWindow {
  if (opts.override?.startIso && opts.override?.endIso) {
    return {
      cycleStartDate: opts.override.startIso,
      cycleEndDate: opts.override.endIso,
      inferred: false,
    };
  }
  if (opts.override?.endIso) {
    return {
      cycleStartDate: addDays(opts.override.endIso, -13),
      cycleEndDate: opts.override.endIso,
      inferred: false,
    };
  }
  if (opts.lastCycleEndIso) {
    const start = addDays(opts.lastCycleEndIso, 1);
    return {
      cycleStartDate: start,
      cycleEndDate: addDays(start, 13),
      inferred: true,
    };
  }
  // Fallback: latest bank-line date is the end, 13 days back is the start
  const sorted = opts.bankLines.map(l => l.date).sort();
  const end = sorted[sorted.length - 1] ?? new Date().toISOString().slice(0, 10);
  return {
    cycleStartDate: addDays(end, -13),
    cycleEndDate: end,
    inferred: true,
  };
}

/* ---------- Main compose ---------- */

export function composePreview(opts: {
  window: FortnightWindow;
  taps: Taps;
  bankByAccount: { account: string; lines: BankLine[] }[];
  kanLines: KanLine[];
  shlLines: ShlLine[];
}): IngestPreview {
  const { window, taps } = opts;
  const { cycleStartDate, cycleEndDate } = window;
  const warnings: IngestWarning[] = [];
  const suspectedCapital: IngestPreview['suspectedCapital'] = [];

  // Filter all bank lines to the window
  const inWin = (l: BankLine) => l.date >= cycleStartDate && l.date <= cycleEndDate;
  const tantaIncome = (opts.bankByAccount.find(b => b.account === 'tanta_income')?.lines ?? []).filter(inWin);
  const opex8_1k    = (opts.bankByAccount.find(b => b.account === 'opex_8_1k')?.lines ?? []).filter(inWin);
  const expensesCc  = (opts.bankByAccount.find(b => b.account === 'expenses_cc')?.lines ?? []).filter(inWin);

  /* ---------- 1) Trading income (from Tanta Income deposits) ---------- */
  const incomeBySource: IncomeBySource = {};
  let trailIncome = 0;
  let upfrontIncome = 0;
  let tradingIncomeCash = 0;

  for (const l of tantaIncome) {
    if (l.amount <= 0) continue;
    if (l.rawCategory.startsWith('CAPITAL:')) {
      suspectedCapital.push({
        date: l.date, amount: l.amount, payee: l.payee,
        reason: l.rawCategory.replace(/^CAPITAL:\s*/, ''),
      });
      continue;
    }
    tradingIncomeCash += l.amount;
    const src = l.knownSource ?? 'Other';
    if (!incomeBySource[src]) incomeBySource[src] = {};
    // Default the whole deposit to trail; if KAN/SHL files supplied below, we
    // replace these defaults with the invoice-level split.
    addToBreakdown(incomeBySource[src]!, 'trail', l.amount);
    trailIncome += l.amount;
  }

  /* ---------- 2) Refine KAN split from xlsx if provided ---------- */
  const kanWin = kanInWindow(opts.kanLines, cycleStartDate, cycleEndDate);
  if (kanWin.length > 0 && incomeBySource['KAN']) {
    const k = kanTotals(kanWin);
    const bankKanTotal = (incomeBySource['KAN'].trail ?? 0) + (incomeBySource['KAN'].upfront ?? 0);
    const xlsxTotal = k.upfront + k.trail + k.other;
    // Replace the bank-only KAN allocation with the invoice-level split
    trailIncome -= incomeBySource['KAN'].trail ?? 0;
    upfrontIncome -= incomeBySource['KAN'].upfront ?? 0;
    incomeBySource['KAN'] = {};
    if (k.upfront > 0) { incomeBySource['KAN'].upfront = k.upfront; upfrontIncome += k.upfront; }
    if (k.trail   > 0) { incomeBySource['KAN'].trail   = k.trail;   trailIncome   += k.trail;   }
    if (k.other   > 0) { incomeBySource['KAN'].other   = k.other; }

    if (Math.abs(bankKanTotal - xlsxTotal) > 1) {
      warnings.push({
        severity: 'warn',
        title: 'KAN xlsx total doesn\'t match bank deposits',
        body: `Bank shows $${bankKanTotal.toFixed(2)} in KAN deposits for the window; the xlsx totals $${xlsxTotal.toFixed(2)}. Confirm export covers the same window.`,
      });
    }
  } else if (kanWin.length > 0 && !incomeBySource['KAN']) {
    warnings.push({
      severity: 'warn',
      title: 'KAN xlsx has lines in this window but no bank deposits',
      body: `${kanWin.length} KAN line(s) sit in the window but no KAN deposits hit Tanta Income. Confirm payment timing.`,
    });
  }

  /* ---------- 3) Refine SHL split from CSVs if provided ---------- */
  const shlWin = shlInWindow(opts.shlLines, cycleStartDate, cycleEndDate);
  if (shlWin.length > 0 && incomeBySource['SHL']) {
    const s = shlTotals(shlWin);
    const bankShlTotal = (incomeBySource['SHL'].trail ?? 0) + (incomeBySource['SHL'].upfront ?? 0);
    const csvTotal = s.upfront + s.trail + s.other;
    trailIncome -= incomeBySource['SHL'].trail ?? 0;
    upfrontIncome -= incomeBySource['SHL'].upfront ?? 0;
    incomeBySource['SHL'] = {};
    if (s.upfront > 0) { incomeBySource['SHL'].upfront = s.upfront; upfrontIncome += s.upfront; }
    if (s.trail   > 0) { incomeBySource['SHL'].trail   = s.trail;   trailIncome   += s.trail;   }
    if (s.other   > 0) { incomeBySource['SHL'].other   = s.other; }

    if (Math.abs(bankShlTotal - csvTotal) > 1) {
      warnings.push({
        severity: 'warn',
        title: 'SHL CSV total doesn\'t match bank deposits',
        body: `Bank shows $${bankShlTotal.toFixed(2)} in SHL deposits for the window; the SHL schedules total $${csvTotal.toFixed(2)}. Confirm both monthly schedules are present.`,
      });
    }
  } else if (incomeBySource['SHL'] && shlWin.length === 0 && opts.shlLines.length === 0) {
    warnings.push({
      severity: 'warn',
      title: 'SHL deposits in bank, no SHL schedules uploaded',
      body: `SHL deposits hit the bank in this window but no ASBAIMS@asb.co.nz CSVs were uploaded — the trail/upfront split is provisional (all classed as trail).`,
    });
  }

  /* ---------- 4) Prescribed allocations from this fortnight's TAPs ---------- */
  const allocationsPrescribed: Allocations = {
    opex:     +(tradingIncomeCash * taps.opex).toFixed(2),
    salaries: +(tradingIncomeCash * taps.salaries).toFixed(2),
    tax:      +(tradingIncomeCash * taps.tax).toFixed(2),
    profit:   +(tradingIncomeCash * taps.profit).toFixed(2),
  };

  /* ---------- 5) Allocations actual (from Tanta Income outflows) ---------- */
  const allocationsActual: Allocations = { opex: 0, salaries: 0, tax: 0, profit: 0 };
  for (const l of tantaIncome) {
    if (l.amount >= 0) continue;
    const v = Math.abs(l.amount);
    if (l.rawCategory.includes('-> Tax')) allocationsActual.tax += v;
    else if (l.rawCategory.includes('-> Profit')) allocationsActual.profit += v;
    else if (l.rawCategory.includes('-> Opex 8.1K (Salaries')) allocationsActual.salaries += v;
    else if (l.rawCategory.includes('-> Opex 8.1K (Opex')) allocationsActual.opex += v;
  }

  /* ---------- 6) Drawings + opex categories + true opex (from Opex 8.1K) ---------- */
  let drawingsChris = 0;
  let drawingsAnthony = 0;
  let trueOpex = 0;
  const opexByCategory: OpexByCategory = {};

  for (const l of opex8_1k) {
    if (l.amount >= 0) {
      if (l.rawCategory.startsWith('CAPITAL:')) {
        suspectedCapital.push({
          date: l.date, amount: l.amount, payee: l.payee,
          reason: l.rawCategory.replace(/^CAPITAL:\s*/, '') + ' (inflow to Opex 8.1K)',
        });
      }
      continue;
    }
    const v = Math.abs(l.amount);
    if (l.rawCategory.startsWith('DRAW: Chris')) { drawingsChris += v; continue; }
    if (l.rawCategory.startsWith('DRAW: Anthony')) { drawingsAnthony += v; continue; }
    if (l.rawCategory.startsWith('DRAW: Ant')) { drawingsAnthony += v; continue; }
    if (l.rawCategory.startsWith('TRANSFER:')) continue;   // internal sweeps don't count as opex
    if (l.rawCategory.startsWith('CAPITAL:')) {
      suspectedCapital.push({
        date: l.date, amount: -v, payee: l.payee,
        reason: l.rawCategory.replace(/^CAPITAL:\s*/, ''),
      });
      continue;
    }
    if (l.rawCategory.startsWith('OPEX:')) {
      const label = l.rawCategory.replace(/^OPEX:\s*/, '').split(' (')[0] as keyof OpexByCategory;
      opexByCategory[label] = (opexByCategory[label] ?? 0) + v;
      trueOpex += v;
    }
  }

  /* ---------- 7) Add Expenses CC line items into trueOpex ---------- */
  for (const l of expensesCc) {
    if (l.amount >= 0) continue;
    const v = Math.abs(l.amount);
    if (l.rawCategory.startsWith('OPEX:')) {
      const label = l.rawCategory.replace(/^OPEX:\s*/, '').split(' (')[0] as keyof OpexByCategory;
      opexByCategory[label] = (opexByCategory[label] ?? 0) + v;
      trueOpex += v;
    }
  }

  /* ---------- 8) Flags ---------- */
  const flags = warnings.slice();
  if (tradingIncomeCash > 0 && allocationsActual.opex + allocationsActual.salaries + allocationsActual.tax + allocationsActual.profit === 0) {
    flags.push({
      severity: 'warn',
      title: 'No Profit First transfers detected in window',
      body: 'Bank shows trading income but no allocation outflows from Tanta Income. Either no transfers have happened yet, or the catch-up is still pending.',
    });
  }
  if (tradingIncomeCash > 0 && tradingIncomeCash < 2000) {
    flags.push({
      severity: 'warn',
      title: 'Low-income fortnight',
      body: `Trading income $${tradingIncomeCash.toFixed(2)} is under the usual $2k threshold — the 49/45/4/2 split will be tiny.`,
    });
  }
  if (suspectedCapital.length > 0) {
    flags.push({
      severity: 'warn',
      title: `${suspectedCapital.length} suspected capital line(s)`,
      body: 'Lines flagged as capital pass-through / asset sale are listed below. Confirm they should be excluded from trading income before commit.',
    });
  }

  /* ---------- 9) Assemble the CycleRow ---------- */
  const cycleRow: CycleRow = {
    cycleEndDate,
    cycleStartDate,
    quarter: quarterFromDate(cycleEndDate),
    tradingIncomeCash: +tradingIncomeCash.toFixed(2),
    tradingIncomeEarned: +tradingIncomeCash.toFixed(2),  // earned == cash unless overridden
    trailIncome: +trailIncome.toFixed(2),
    upfrontIncome: +upfrontIncome.toFixed(2),
    incomeBySource,
    allocationsPrescribed,
    allocationsActual,
    trueOpex: +trueOpex.toFixed(2),
    opexByCategory,
    drawingsChris: +drawingsChris.toFixed(2),
    drawingsAnthony: +drawingsAnthony.toFixed(2),
    accountBalancesEnd: {},
    flags,
    notes: window.inferred
      ? 'Auto-ingested via /finance/ingest. Window was inferred from prior cycle + 14 days.'
      : 'Auto-ingested via /finance/ingest. Window was supplied by the user.',
  };

  return {
    window,
    cycleRow,
    warnings,
    suspectedCapital,
    filesParsed: {
      bankCsvs: [],   // populated by the caller
      kanXlsx: null,  // populated by the caller
      shlCsvs: [],    // populated by the caller
    },
  };
}
