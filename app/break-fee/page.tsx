'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type LiveSwapRates = {
  observationDate: string;
  rates: Record<string, number>;
  source: string;
  fetchedAt: string;
};

const TERM_MONTHS: Array<{ key: string; months: number }> = [
  { key: '1y', months: 12 },
  { key: '2y', months: 24 },
  { key: '3y', months: 36 },
  { key: '4y', months: 48 },
  { key: '5y', months: 60 },
  { key: '7y', months: 84 },
  { key: '10y', months: 120 },
];

/**
 * Linearly interpolate the swap rate for an arbitrary remaining-month value
 * using the published curve points. Clamps to the endpoints outside [12, 120].
 */
function interpolateSwapRate(
  rates: Record<string, number>,
  remainingMonths: number,
): number | null {
  const points = TERM_MONTHS.map((t) => ({ months: t.months, rate: rates[t.key] }))
    .filter((p) => typeof p.rate === 'number') as Array<{ months: number; rate: number }>;
  if (points.length === 0) return null;
  if (points.length === 1) return points[0].rate;
  points.sort((a, b) => a.months - b.months);

  if (remainingMonths <= points[0].months) return points[0].rate;
  if (remainingMonths >= points[points.length - 1].months) return points[points.length - 1].rate;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (remainingMonths >= a.months && remainingMonths <= b.months) {
      const frac = (remainingMonths - a.months) / (b.months - a.months);
      return a.rate + frac * (b.rate - a.rate);
    }
  }
  return null;
}

type BankId = 'anz' | 'asb' | 'bnz' | 'westpac' | 'kiwibank';

type BankConfig = {
  id: BankId;
  name: string;
  accent: string;
  // bps added to the wholesale swap rate to approximate the bank's internal
  // funding/cost-of-funds curve for break-fee calcs (indicative — banks do not
  // publish exact funding spreads).
  fundingSpreadBps: number;
  // whether the bank present-values future cashflows back to today
  presentValue: boolean;
  // flat admin fee added to the calculated economic loss
  adminFee: number;
  methodology: string;
};

// Admin fees verified against each bank's published fee schedule (May 2026):
//   ANZ      $300  Early repayment administration fee (anz.co.nz/rates-fees-agreements/home-loans)
//   ASB       $10  Early repayment adjustment administration fee
//   BNZ        $0  No separate administration fee published; the early repayment
//                  charge itself is the only line.
//   Westpac    $0  Westpac removed its early-repayment admin fees in 2024-25;
//                  prepayment cost (the break itself) still applies.
//   Kiwibank  $40  Administration fee per excess repayment on the fixed component.
//
// These numbers stack on top of the calculated economic loss. The funding
// spread / PV-discount treatments are unchanged from before.
const BANKS: Record<BankId, BankConfig> = {
  anz: {
    id: 'anz',
    name: 'ANZ',
    accent: '#2b6485',
    fundingSpreadBps: 0,
    presentValue: true,
    adminFee: 300,
    methodology:
      'Compares ANZ wholesale swap rate at fixation vs. today\'s swap rate for the remaining term. Each scheduled payment of the rate differential is present-valued back to today. Adds ANZ\'s $300 early repayment administration fee.',
  },
  asb: {
    id: 'asb',
    name: 'ASB',
    accent: '#eab308',
    fundingSpreadBps: 25,
    presentValue: true,
    adminFee: 10,
    methodology:
      'Uses ASB\'s wholesale rate (swap + ASB funding margin) at fixation vs. today. Present-values future cashflows. Adds ASB\'s $10 early repayment adjustment administration fee.',
  },
  bnz: {
    id: 'bnz',
    name: 'BNZ',
    accent: '#031f41',
    fundingSpreadBps: 0,
    presentValue: false,
    adminFee: 0,
    methodology:
      'Simple interest differential — wholesale swap rate at fixation vs. today, multiplied by remaining balance and remaining term. No PV discount applied. BNZ does not publish a separate administration fee on top.',
  },
  westpac: {
    id: 'westpac',
    name: 'Westpac',
    accent: '#ba1a1a',
    fundingSpreadBps: 15,
    presentValue: true,
    adminFee: 0,
    methodology:
      'Westpac wholesale rate (swap + Westpac wholesale margin) at fixation vs. today. Present-values the differential over the remaining term. Westpac removed its early-repayment admin fees in 2024-25 — only the prepayment cost itself applies.',
  },
  kiwibank: {
    id: 'kiwibank',
    name: 'Kiwibank',
    accent: '#22c55e',
    fundingSpreadBps: 25,
    presentValue: true,
    adminFee: 40,
    methodology:
      'Kiwibank cost-of-funds rate (swap + Kiwibank funding spread) at fixation vs. today. Present-values cashflows. Adds Kiwibank\'s $40 administration fee per excess repayment on the fixed component.',
  },
};

const BANK_ORDER: BankId[] = ['anz', 'asb', 'bnz', 'westpac', 'kiwibank'];

function fmtNZD(v: number): string {
  if (!isFinite(v)) return '$0';
  return v.toLocaleString('en-NZ', {
    style: 'currency',
    currency: 'NZD',
    maximumFractionDigits: 0,
  });
}

type CalcResult = {
  bankId: BankId;
  bankName: string;
  accent: string;
  rateAtFixation: number; // effective bank funding rate at fixation
  rateToday: number; // effective bank funding rate today
  rateDifferential: number; // % (e.g. 0.02 for 2%)
  economicLoss: number; // before admin fee
  adminFee: number;
  total: number;
  methodology: string;
};

function calculateBreakFee(
  bank: BankConfig,
  balance: number,
  swapAtFixation: number, // %, e.g. 4.50
  swapToday: number, // %
  remainingMonths: number
): CalcResult {
  const spread = bank.fundingSpreadBps / 100; // bps → percentage points
  const rateAtFixation = swapAtFixation + spread;
  const rateToday = swapToday + spread;
  const rateDiffPct = rateAtFixation - rateToday; // percentage points
  const rateDiff = rateDiffPct / 100; // decimal

  // If current rate is higher than fixation rate, no break fee owed.
  if (rateDiff <= 0) {
    return {
      bankId: bank.id,
      bankName: bank.name,
      accent: bank.accent,
      rateAtFixation,
      rateToday,
      rateDifferential: rateDiffPct,
      economicLoss: 0,
      adminFee: 0,
      total: 0,
      methodology: bank.methodology,
    };
  }

  const remainingYears = remainingMonths / 12;

  let economicLoss: number;

  if (bank.presentValue) {
    // Approximate PV of monthly rate differential cashflows on the balance,
    // discounted at today's rate. This is an indicative model — banks use
    // the exact amortising payment schedule.
    const monthlyDiff = rateDiff / 12;
    const monthlyDiscount = rateToday / 100 / 12;
    let pv = 0;
    for (let m = 1; m <= remainingMonths; m++) {
      const cashflow = balance * monthlyDiff;
      const discountFactor = 1 / Math.pow(1 + monthlyDiscount, m);
      pv += cashflow * discountFactor;
    }
    economicLoss = pv;
  } else {
    // Simple interest differential (BNZ-style)
    economicLoss = balance * rateDiff * remainingYears;
  }

  return {
    bankId: bank.id,
    bankName: bank.name,
    accent: bank.accent,
    rateAtFixation,
    rateToday,
    rateDifferential: rateDiffPct,
    economicLoss,
    adminFee: bank.adminFee,
    total: economicLoss + bank.adminFee,
    methodology: bank.methodology,
  };
}

const ORIGINAL_TERM_OPTIONS: Array<{ value: string; label: string; months: number }> = [
  { value: '6mo', label: '6 months', months: 6 },
  { value: '1y', label: '1 year', months: 12 },
  { value: '18mo', label: '18 months', months: 18 },
  { value: '2y', label: '2 years', months: 24 },
  { value: '3y', label: '3 years', months: 36 },
  { value: '4y', label: '4 years', months: 48 },
  { value: '5y', label: '5 years', months: 60 },
];

function originalTermMonths(key: string): number {
  return ORIGINAL_TERM_OPTIONS.find((o) => o.value === key)?.months ?? 24;
}

export default function BreakFeeCalculator() {
  const [balance, setBalance] = useState<number>(500000);
  const [fixedRate, setFixedRate] = useState<number>(6.5);
  const [newRate, setNewRate] = useState<number>(5.0);
  const [swapAtFixation, setSwapAtFixation] = useState<number>(5.0);
  const [swapToday, setSwapToday] = useState<number>(4.0);
  const [fixEndDate, setFixEndDate] = useState<string>('');
  const [originalTerm, setOriginalTerm] = useState<string>('2y');
  const [selectedBank, setSelectedBank] = useState<BankId | 'all'>('all');

  // Default the end date client-side to avoid SSR/CSR hydration drift.
  useEffect(() => {
    if (fixEndDate) return;
    const d = new Date();
    d.setMonth(d.getMonth() + 24);
    setFixEndDate(d.toISOString().slice(0, 10));
  }, [fixEndDate]);

  const remainingMonths = useMemo(() => {
    if (!fixEndDate) return 0;
    const end = new Date(fixEndDate + 'T00:00:00');
    if (isNaN(end.getTime())) return 0;
    const now = new Date();
    const yearDiff = end.getFullYear() - now.getFullYear();
    const monthDiff = end.getMonth() - now.getMonth();
    const dayFraction = (end.getDate() - now.getDate()) / 30;
    return Math.max(0, Math.round(yearDiff * 12 + monthDiff + dayFraction));
  }, [fixEndDate]);

  const [live, setLive] = useState<LiveSwapRates | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState<boolean>(false);

  const loadLiveRates = useCallback(async () => {
    setLiveLoading(true);
    setLiveError(null);
    try {
      const res = await fetch('/api/swap-rates', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: LiveSwapRates = await res.json();
      setLive(data);
    } catch (err: any) {
      setLiveError(err.message || 'Failed to load swap rates');
    } finally {
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLiveRates();
  }, [loadLiveRates]);

  // Re-interpolate "swap today" whenever live rates or remaining months change.
  useEffect(() => {
    if (!live) return;
    const interp = interpolateSwapRate(live.rates, remainingMonths);
    if (interp != null) setSwapToday(parseFloat(interp.toFixed(2)));
  }, [live, remainingMonths]);

  // Compute the fixation date by subtracting the original term from the fix
  // end date. Used to look up the historical swap rate from the backfilled
  // archive.
  const fixationDate = useMemo(() => {
    if (!fixEndDate) return null;
    const end = new Date(fixEndDate + 'T00:00:00');
    if (isNaN(end.getTime())) return null;
    end.setMonth(end.getMonth() - originalTermMonths(originalTerm));
    return end.toISOString().slice(0, 10);
  }, [fixEndDate, originalTerm]);

  // Auto-fill "swap rate when client fixed" by looking up the historical row
  // for the fixation date and picking the curve point matching the original
  // term. Falls back silently if the historical row isn't in the DB yet.
  const [fixationStatus, setFixationStatus] = useState<{
    kind: 'idle' | 'loading' | 'ok' | 'error';
    message?: string;
    observationDate?: string;
  }>({ kind: 'idle' });

  useEffect(() => {
    if (!fixationDate) return;
    let cancelled = false;
    setFixationStatus({ kind: 'loading' });
    fetch(`/api/swap-rates?date=${fixationDate}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<LiveSwapRates>;
      })
      .then((data) => {
        if (cancelled) return;
        const rate = interpolateSwapRate(data.rates, originalTermMonths(originalTerm));
        if (rate != null) {
          setSwapAtFixation(parseFloat(rate.toFixed(2)));
          setFixationStatus({
            kind: 'ok',
            observationDate: typeof data.observationDate === 'string'
              ? data.observationDate.slice(0, 10)
              : undefined,
          });
        } else {
          setFixationStatus({ kind: 'error', message: 'No matching curve point' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setFixationStatus({ kind: 'error', message: err.message });
      });
    return () => { cancelled = true; };
  }, [fixationDate, originalTerm]);

  const results = useMemo(() => {
    return BANK_ORDER.map((id) =>
      calculateBreakFee(BANKS[id], balance, swapAtFixation, swapToday, remainingMonths)
    );
  }, [balance, swapAtFixation, swapToday, remainingMonths]);

  // Refixing economics: how much the client saves over the remaining term
  // by paying the break fee now and locking in `newRate` instead of staying
  // on `fixedRate` until the natural end of the fix.
  const savings = useMemo(() => {
    const annualSaving = balance * Math.max(0, fixedRate - newRate) / 100;
    const monthlySaving = annualSaving / 12;
    const totalSaving = monthlySaving * remainingMonths;
    return { monthlySaving, totalSaving, annualSaving };
  }, [balance, fixedRate, newRate, remainingMonths]);

  type Verdict = CalcResult & {
    netBenefit: number;        // totalSaving − break fee. >0 = breaking pays off
    breakevenMonths: number | null; // null if monthlySaving = 0
  };

  const verdicts: Verdict[] = useMemo(() => {
    return results.map((r) => {
      const netBenefit = savings.totalSaving - r.total;
      const breakevenMonths = savings.monthlySaving > 0 ? r.total / savings.monthlySaving : null;
      return { ...r, netBenefit, breakevenMonths };
    });
  }, [results, savings]);

  const filteredVerdicts = useMemo(() => {
    if (selectedBank === 'all') return verdicts;
    return verdicts.filter((r) => r.bankId === selectedBank);
  }, [verdicts, selectedBank]);

  return (
    <div className="min-h-screen bg-surface-container-low">
      {/* Sidebar */}
      <aside className="h-screen w-64 fixed left-0 top-0 bg-surface-container-low flex flex-col py-6 pl-4 pr-0 overflow-y-auto z-50">
        <div className="mb-10 px-4">
          <h1 className="text-lg font-bold text-[#0B4E6F] tracking-tighter">Tanta</h1>
          <p className="text-xs text-on-surface-variant font-medium">Mortgage Architect</p>
        </div>
        <nav className="flex-grow space-y-1">
          <a
            className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] hover:bg-white/40 transition-all duration-200"
            href="/"
          >
            <span className="material-symbols-outlined">account_tree</span>
            <span className="text-sm">Pipeline</span>
          </a>
          <a
            className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] hover:bg-white/40 transition-all duration-200"
            href="/lenders"
          >
            <span className="material-symbols-outlined">compare_arrows</span>
            <span className="text-sm">Bank Comparisons</span>
          </a>
          <a
            className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] hover:bg-white/40 transition-all duration-200"
            href="/lenders/products"
          >
            <span className="material-symbols-outlined">fact_check</span>
            <span className="text-sm">Lender Product Comparisons</span>
          </a>
          <a
            className="flex items-center gap-3 px-4 py-3 bg-white text-[#228EBF] font-bold rounded-l-full shadow-sm"
            href="/break-fee"
          >
            <span className="material-symbols-outlined">request_quote</span>
            <span className="text-sm">Break Fee Calculator</span>
          </a>
        </nav>
      </aside>

      <main className="ml-64 min-h-screen pb-20">
        <header className="flex justify-between items-center px-8 w-full sticky top-0 z-40 bg-surface-container-low h-16 border-b border-black/5">
          <h2 className="text-xl font-bold text-[#0B4E6F]">Break Fee Calculator</h2>
          <div className="text-xs text-on-surface-variant">
            Internal adviser tool — indicative only
          </div>
        </header>

        <div className="px-8 py-6 space-y-6">
          {/* Live swap rate banner */}
          {/* Inputs */}
          <section className="bg-white rounded-2xl shadow-sm p-6">
            <h3 className="text-sm font-bold text-[#0B4E6F] uppercase tracking-wider mb-4">
              Loan details
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <NumberField
                label="Loan balance"
                value={balance}
                onChange={setBalance}
                prefix="$"
                step={1000}
                hint="Outstanding amount on the fix"
              />
              <NumberField
                label="Client's fixed rate"
                value={fixedRate}
                onChange={setFixedRate}
                suffix="%"
                step={0.05}
                hint="What they're paying now"
              />
              <NumberField
                label="New rate available"
                value={newRate}
                onChange={setNewRate}
                suffix="%"
                step={0.05}
                hint="What they could refix at"
              />
              <label className="block">
                <div className="text-xs font-medium text-on-surface-variant mb-1">Original fix term</div>
                <select
                  value={originalTerm}
                  onChange={(e) => setOriginalTerm(e.target.value)}
                  className="w-full bg-surface-container-highest rounded-lg py-2 px-3 text-sm font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-[#228EBF]"
                >
                  {ORIGINAL_TERM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-on-surface-variant mt-1">
                  How long they fixed for
                </div>
              </label>
              <label className="block">
                <div className="text-xs font-medium text-on-surface-variant mb-1">Fix end date</div>
                <input
                  type="date"
                  value={fixEndDate}
                  onChange={(e) => setFixEndDate(e.target.value)}
                  className="w-full bg-surface-container-highest rounded-lg py-2 px-3 text-sm font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-[#228EBF]"
                />
                <div className="text-[10px] text-on-surface-variant mt-1">
                  {remainingMonths > 0
                    ? `${remainingMonths} month${remainingMonths === 1 ? '' : 's'} remaining`
                    : fixEndDate
                      ? 'Fix already over — no break fee'
                      : ' '}
                </div>
              </label>
            </div>
            <div className="mt-3 text-[11px] text-on-surface-variant space-y-0.5">
              {fixationDate && (
                <div>
                  {fixationStatus.kind === 'loading' && (
                    <>Looking up wholesale rate when client fixed ({fixationDate})…</>
                  )}
                  {fixationStatus.kind === 'ok' && (
                    <>
                      Wholesale rate when client fixed (~{fixationDate}, {originalTerm}):{' '}
                      <span className="font-semibold">{swapAtFixation.toFixed(2)}%</span>
                      {fixationStatus.observationDate && fixationStatus.observationDate !== fixationDate && (
                        <> · nearest archive row: {fixationStatus.observationDate}</>
                      )}
                    </>
                  )}
                  {fixationStatus.kind === 'error' && (
                    <span className="text-amber-700">
                      Couldn't auto-fill historical rate ({fixationStatus.message}). Using {swapAtFixation.toFixed(2)}%.
                    </span>
                  )}
                </div>
              )}
              <div>
                Wholesale rate today
                {remainingMonths > 0 ? ` (${remainingMonths} mo curve point)` : ''}:{' '}
                <span className="font-semibold">{swapToday.toFixed(2)}%</span>
                {live && (
                  <> · from RBNZ B2 close {live.observationDate.slice(0, 10)}</>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <FilterChip
                active={selectedBank === 'all'}
                onClick={() => setSelectedBank('all')}
                label="All banks"
              />
              {BANK_ORDER.map((id) => (
                <FilterChip
                  key={id}
                  active={selectedBank === id}
                  onClick={() => setSelectedBank(id)}
                  label={BANKS[id].name}
                  accent={BANKS[id].accent}
                />
              ))}
            </div>
          </section>

          {/* Refixing scenario summary */}
          <section className="bg-gradient-to-br from-[#0B4E6F] to-[#228EBF] rounded-2xl shadow-sm p-6 text-white">
            <h3 className="text-sm font-bold uppercase tracking-wider opacity-80 mb-3">
              If they refix at {newRate.toFixed(2)}%
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div>
                <div className="text-[11px] opacity-70 uppercase tracking-wider">Monthly saving</div>
                <div className="text-3xl font-bold mt-1">{fmtNZD(savings.monthlySaving)}</div>
                <div className="text-xs opacity-70 mt-1">
                  on $<span className="font-semibold">{balance.toLocaleString('en-NZ')}</span>
                  {' '}× {(fixedRate - newRate).toFixed(2)} pp
                </div>
              </div>
              <div>
                <div className="text-[11px] opacity-70 uppercase tracking-wider">Total saving over remaining term</div>
                <div className="text-3xl font-bold mt-1">{fmtNZD(savings.totalSaving)}</div>
                <div className="text-xs opacity-70 mt-1">
                  {remainingMonths > 0 ? `${remainingMonths} months × ${fmtNZD(savings.monthlySaving)}` : 'no months remaining'}
                </div>
              </div>
              <div>
                <div className="text-[11px] opacity-70 uppercase tracking-wider">Annual saving</div>
                <div className="text-3xl font-bold mt-1">{fmtNZD(savings.annualSaving)}</div>
                <div className="text-xs opacity-70 mt-1">if rates held for a full year</div>
              </div>
            </div>
          </section>

          {/* Big results table — break fee vs savings vs net per bank */}
          <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-black/5">
              <h3 className="text-sm font-bold text-[#0B4E6F] uppercase tracking-wider">
                Break fee vs. savings — by bank
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">
                Net benefit = total savings over remaining term − break fee. Positive (green) means breaking pays off.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-container-highest">
                  <tr className="text-[11px] uppercase tracking-wider text-on-surface-variant">
                    <th className="text-left px-6 py-3 font-semibold">Bank</th>
                    <th className="text-right px-6 py-3 font-semibold">Break fee</th>
                    <th className="text-right px-6 py-3 font-semibold">Total savings</th>
                    <th className="text-right px-6 py-3 font-semibold">Net benefit</th>
                    <th className="text-right px-6 py-3 font-semibold">Breakeven</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVerdicts.map((v) => {
                    const isWin = v.netBenefit > 0;
                    return (
                      <tr key={v.bankId} className="border-t border-black/5">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span className="w-2 h-8 rounded" style={{ backgroundColor: v.accent }} />
                            <span className="font-bold text-[#0B4E6F] text-base">{v.bankName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-semibold text-on-surface">{fmtNZD(v.total)}</td>
                        <td className="px-6 py-4 text-right font-semibold text-on-surface">{fmtNZD(savings.totalSaving)}</td>
                        <td className={`px-6 py-4 text-right text-lg font-bold ${isWin ? 'text-emerald-700' : 'text-red-700'}`}>
                          {isWin ? '+' : ''}{fmtNZD(v.netBenefit)}
                        </td>
                        <td className="px-6 py-4 text-right text-on-surface-variant">
                          {v.breakevenMonths === null
                            ? '—'
                            : v.breakevenMonths > remainingMonths
                              ? `${Math.round(v.breakevenMonths)} mo (past fix end)`
                              : `${Math.round(v.breakevenMonths)} mo`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Detail bank cards (collapsible) */}
          <section>
            <h3 className="text-sm font-bold text-[#0B4E6F] uppercase tracking-wider mb-3">
              Per-bank detail
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredVerdicts.map((r) => (
                <BankResultCard key={r.bankId} result={r} />
              ))}
            </div>
          </section>

          {/* Live swap rate banner — moved here so it's reference info, not the headline */}
          <section className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#228EBF]">trending_up</span>
                <div>
                  <div className="text-sm font-bold text-[#0B4E6F]">Live wholesale swap rates</div>
                  {live && !liveError && (
                    <div className="text-xs text-on-surface-variant mt-0.5">
                      As at {new Date(live.observationDate).toLocaleDateString('en-NZ', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {' · '}
                      <a
                        href={live.source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#228EBF] hover:underline"
                      >
                        RBNZ B2 (daily close)
                      </a>
                      {' · '}
                      Auto-fills "wholesale rate today" using linear interp between curve points
                    </div>
                  )}
                  {liveError && (
                    <div className="text-xs text-red-700 mt-0.5">
                      Couldn't load live rates: {liveError}. Enter manually above.
                    </div>
                  )}
                  {!live && !liveError && (
                    <div className="text-xs text-on-surface-variant mt-0.5">
                      {liveLoading ? 'Loading…' : 'Not yet loaded.'}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {live && Object.entries(live.rates).map(([k, v]) => (
                  <span
                    key={k}
                    className="px-3 py-1 bg-surface-container-highest rounded-full text-xs font-semibold text-on-surface"
                  >
                    {k}: {v.toFixed(2)}%
                  </span>
                ))}
                <button
                  onClick={loadLiveRates}
                  disabled={liveLoading}
                  className="px-3 py-1.5 bg-[#0B4E6F] hover:bg-[#228EBF] text-white text-xs font-semibold rounded-full transition-colors disabled:opacity-50"
                >
                  {liveLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
          </section>

          {/* Disclaimer */}
          <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex gap-3">
              <span className="material-symbols-outlined text-amber-700">info</span>
              <div className="text-sm text-amber-900 space-y-2">
                <p className="font-bold">Indicative only</p>
                <p>
                  Each bank uses its own internal funding curve and exact methodology. This
                  calculator approximates the published methods using the wholesale swap rates
                  you input plus a typical funding spread for each bank. Real break quotes
                  will differ — usually within 5–15% of these figures.
                </p>
                <p>
                  Always have the client request the official break quote from their bank
                  before making a decision. Do not share these numbers with clients as a
                  firm quote.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-on-surface-variant mb-1">{label}</div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`w-full bg-surface-container-highest rounded-lg py-2 ${
            prefix ? 'pl-7' : 'pl-3'
          } ${suffix ? 'pr-7' : 'pr-3'} text-sm font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-[#228EBF]`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">
            {suffix}
          </span>
        )}
      </div>
      {hint && <div className="text-[10px] text-on-surface-variant mt-1">{hint}</div>}
    </label>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
        active
          ? 'bg-[#0B4E6F] text-white shadow-sm'
          : 'bg-surface-container-highest text-on-surface-variant hover:bg-black/10'
      }`}
      style={active && accent ? { backgroundColor: accent } : undefined}
    >
      {label}
    </button>
  );
}

function BankResultCard({ result }: { result: CalcResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="bg-white rounded-2xl shadow-sm border-t-4 overflow-hidden"
      style={{ borderColor: result.accent }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-5 text-left hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-baseline gap-3">
          <h4 className="text-lg font-bold text-[#0B4E6F]">{result.bankName}</h4>
          <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">
            {open ? 'Hide details' : 'Show details'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold" style={{ color: result.accent }}>
            {fmtNZD(result.total)}
          </span>
          <span
            className="material-symbols-outlined text-on-surface-variant transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            expand_more
          </span>
        </div>
      </button>
      {open && (
        <div className="px-5 pb-5 -mt-1">
          <div className="space-y-1.5 text-sm">
            <Row label="Wholesale rate when client fixed" value={`${result.rateAtFixation.toFixed(2)}%`} />
            <Row label="Wholesale rate today" value={`${result.rateToday.toFixed(2)}%`} />
            <Row
              label="Difference"
              value={`${result.rateDifferential.toFixed(2)} pp`}
              emphasis
            />
            <Row label="Economic loss to bank" value={fmtNZD(result.economicLoss)} />
            {result.adminFee > 0 && (
              <Row label="Bank admin fee" value={fmtNZD(result.adminFee)} />
            )}
          </div>
          <details className="mt-4">
            <summary className="text-xs font-semibold text-[#228EBF] cursor-pointer">
              How {result.bankName} calculates it
            </summary>
            <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">
              {result.methodology}
            </p>
          </details>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-on-surface-variant">{label}</span>
      <span className={emphasis ? 'font-bold text-on-surface' : 'font-medium text-on-surface'}>
        {value}
      </span>
    </div>
  );
}
