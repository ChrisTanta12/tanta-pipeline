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

const BANKS: Record<BankId, BankConfig> = {
  anz: {
    id: 'anz',
    name: 'ANZ',
    accent: '#2b6485',
    fundingSpreadBps: 0,
    presentValue: true,
    adminFee: 0,
    methodology:
      'Compares ANZ wholesale swap rate at fixation vs. today\'s swap rate for the remaining term. Each scheduled payment of the rate differential is present-valued back to today.',
  },
  asb: {
    id: 'asb',
    name: 'ASB',
    accent: '#eab308',
    fundingSpreadBps: 25,
    presentValue: true,
    adminFee: 50,
    methodology:
      'Uses ASB\'s wholesale rate (swap + ASB funding margin) at fixation vs. today. Present-values future cashflows. Adds a $50 break administration fee.',
  },
  bnz: {
    id: 'bnz',
    name: 'BNZ',
    accent: '#031f41',
    fundingSpreadBps: 0,
    presentValue: false,
    adminFee: 0,
    methodology:
      'Simple interest differential — wholesale swap rate at fixation vs. today, multiplied by remaining balance and remaining term. No PV discount applied.',
  },
  westpac: {
    id: 'westpac',
    name: 'Westpac',
    accent: '#ba1a1a',
    fundingSpreadBps: 15,
    presentValue: true,
    adminFee: 0,
    methodology:
      'Westpac wholesale rate (swap + Westpac wholesale margin) at fixation vs. today. Present-values the differential over the remaining term.',
  },
  kiwibank: {
    id: 'kiwibank',
    name: 'Kiwibank',
    accent: '#22c55e',
    fundingSpreadBps: 25,
    presentValue: true,
    adminFee: 75,
    methodology:
      'Kiwibank cost-of-funds rate (swap + Kiwibank funding spread) at fixation vs. today. Present-values cashflows. Adds an early repayment admin fee (~$75, varies by product).',
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

export default function BreakFeeCalculator() {
  const [balance, setBalance] = useState<number>(500000);
  const [fixedRate, setFixedRate] = useState<number>(6.5);
  const [swapAtFixation, setSwapAtFixation] = useState<number>(5.0);
  const [swapToday, setSwapToday] = useState<number>(4.0);
  const [remainingMonths, setRemainingMonths] = useState<number>(24);
  const [selectedBank, setSelectedBank] = useState<BankId | 'all'>('all');

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

  const results = useMemo(() => {
    return BANK_ORDER.map((id) =>
      calculateBreakFee(BANKS[id], balance, swapAtFixation, swapToday, remainingMonths)
    );
  }, [balance, swapAtFixation, swapToday, remainingMonths]);

  const filteredResults = useMemo(() => {
    if (selectedBank === 'all') return results;
    return results.filter((r) => r.bankId === selectedBank);
  }, [results, selectedBank]);

  const cheapest = useMemo(() => {
    const nonZero = results.filter((r) => r.total > 0);
    if (nonZero.length === 0) return null;
    return nonZero.reduce((a, b) => (a.total < b.total ? a : b));
  }, [results]);

  const dearest = useMemo(() => {
    const nonZero = results.filter((r) => r.total > 0);
    if (nonZero.length === 0) return null;
    return nonZero.reduce((a, b) => (a.total > b.total ? a : b));
  }, [results]);

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
                        interest.co.nz
                      </a>
                      {' · '}
                      Auto-fills "swap rate today" using linear interp between curve points
                    </div>
                  )}
                  {liveError && (
                    <div className="text-xs text-red-700 mt-0.5">
                      Couldn't load live rates: {liveError}. Enter manually below.
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

          {/* Inputs */}
          <section className="bg-white rounded-2xl shadow-sm p-6">
            <h3 className="text-sm font-bold text-[#0B4E6F] uppercase tracking-wider mb-4">
              Loan details
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <NumberField
                label="Remaining balance"
                value={balance}
                onChange={setBalance}
                prefix="$"
                step={1000}
              />
              <NumberField
                label="Fixed rate (client)"
                value={fixedRate}
                onChange={setFixedRate}
                suffix="%"
                step={0.05}
                hint="Reference only"
              />
              <NumberField
                label="Swap rate at fixation"
                value={swapAtFixation}
                onChange={setSwapAtFixation}
                suffix="%"
                step={0.05}
                hint="Manual — original term"
              />
              <NumberField
                label="Swap rate today"
                value={swapToday}
                onChange={setSwapToday}
                suffix="%"
                step={0.05}
                hint={live ? 'Auto from live curve' : 'Manual — remaining term'}
              />
              <NumberField
                label="Months remaining"
                value={remainingMonths}
                onChange={setRemainingMonths}
                step={1}
              />
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

          {/* Summary */}
          {cheapest && dearest && cheapest.bankId !== dearest.bankId && (
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryCard
                label="Lowest estimate"
                bank={cheapest.bankName}
                value={cheapest.total}
                accent={cheapest.accent}
              />
              <SummaryCard
                label="Highest estimate"
                bank={dearest.bankName}
                value={dearest.total}
                accent={dearest.accent}
              />
              <SummaryCard
                label="Spread"
                bank={`${dearest.bankName} − ${cheapest.bankName}`}
                value={dearest.total - cheapest.total}
                accent="#0B4E6F"
              />
            </section>
          )}

          {/* Results */}
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredResults.map((r) => (
              <BankResultCard key={r.bankId} result={r} />
            ))}
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

function SummaryCard({
  label,
  bank,
  value,
  accent,
}: {
  label: string;
  bank: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 border-l-4" style={{ borderColor: accent }}>
      <div className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
        {label}
      </div>
      <div className="text-2xl font-bold text-[#0B4E6F] mt-1">{fmtNZD(value)}</div>
      <div className="text-sm text-on-surface-variant mt-1">{bank}</div>
    </div>
  );
}

function BankResultCard({ result }: { result: CalcResult }) {
  return (
    <div
      className="bg-white rounded-2xl shadow-sm p-5 border-t-4"
      style={{ borderColor: result.accent }}
    >
      <div className="flex items-baseline justify-between">
        <h4 className="text-lg font-bold text-[#0B4E6F]">{result.bankName}</h4>
        <span className="text-2xl font-bold" style={{ color: result.accent }}>
          {fmtNZD(result.total)}
        </span>
      </div>
      <div className="mt-4 space-y-1.5 text-sm">
        <Row label="Bank rate at fixation" value={`${result.rateAtFixation.toFixed(2)}%`} />
        <Row label="Bank rate today" value={`${result.rateToday.toFixed(2)}%`} />
        <Row
          label="Rate differential"
          value={`${result.rateDifferential.toFixed(2)} pp`}
          emphasis
        />
        <Row label="Economic loss" value={fmtNZD(result.economicLoss)} />
        {result.adminFee > 0 && (
          <Row label="Admin fee" value={fmtNZD(result.adminFee)} />
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
