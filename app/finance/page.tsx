'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import type {
  CycleRow,
  FinanceConfig,
  CapitalMovement,
  FinanceSnapshot,
  CycleFlag,
} from '@/app/lib/finance-types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

type DataResponse = {
  cycles: CycleRow[];
  config: FinanceConfig | null;
  capitalMovements: CapitalMovement[];
  historyAggregates: FinanceSnapshot['history_aggregates'];
};

// ============================================================================
// Brand palette (locked, matches HTML mockups in Tanta-Finance/reports/)
// ============================================================================
const C = {
  ink:    '#1a1a1a',
  bg:     '#f5f5f0',
  card:   '#ffffff',
  rule:   '#e5e5dc',
  muted:  '#6b6b6b',
  accent: '#1d3557',
  accent2:'#457b9d',
  ok:     '#2d6a4f',
  warn:   '#b67c00',
  bad:    '#9b2226',
  capital:'#8a6fa8',
  soft:   '#f1f3f8',
} as const;

// ============================================================================
// Format helpers
// ============================================================================
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-NZ');
const fmtMoneyExact = (n: number) =>
  '$' + n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => (n * 100).toFixed(1) + '%';
const fmtMoneyShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'm';
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'k';
  return '$' + Math.round(n);
};

// ============================================================================
// Page
// ============================================================================
export default function FinancePage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [data, setData] = useState<DataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    const res = await fetch('/api/finance-data', { cache: 'no-store' });
    if (res.status === 401) { setUnlocked(false); return; }
    if (!res.ok) { setError(`Server returned ${res.status}`); return; }
    setData((await res.json()) as DataResponse);
    setUnlocked(true);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (unlocked === null) return <CenterMsg>Loading…</CenterMsg>;
  if (!unlocked) return <PinGate onUnlocked={fetchData} />;
  if (error) return <CenterMsg className="text-red-700">{error}</CenterMsg>;
  if (!data) return <CenterMsg>Loading data…</CenterMsg>;

  return <Dashboard data={data} onLogout={() => {
    fetch('/api/finance-unlock', { method: 'DELETE' }).then(() => setUnlocked(false));
  }} />;
}

function CenterMsg({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-h-screen flex items-center justify-center text-sm text-neutral-500 ${className}`}>
      {children}
    </div>
  );
}

// ============================================================================
// PIN gate
// ============================================================================
function PinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setErr(null);
    try {
      const res = await fetch('/api/finance-unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }),
      });
      if (res.ok) onUnlocked();
      else if (res.status === 401) setErr('Incorrect PIN');
      else setErr(`Server returned ${res.status}`);
    } finally { setSubmitting(false); }
  }, [pin, onUnlocked]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6"
         style={{ background: `linear-gradient(135deg, ${C.bg} 0%, #ebebe2 100%)` }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-lg border border-neutral-200 p-8 w-full max-w-sm">
        <img src="/tanta-logo.png" alt="Tanta" className="w-24 h-auto mb-6" />
        <div className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 mb-1">Finance</div>
        <h1 className="text-xl font-semibold text-[color:var(--accent)]" style={{ color: C.accent }}>Enter PIN</h1>
        <input
          type="password" value={pin} onChange={e => setPin(e.target.value)} autoFocus
          className="mt-4 w-full px-3 py-2.5 rounded-lg border border-neutral-300 text-base font-mono tracking-widest focus:outline-none focus:ring-2 focus:border-transparent"
          style={{ '--tw-ring-color': C.accent } as React.CSSProperties}
          placeholder="••••"
        />
        {err && <div className="text-xs text-red-700 mt-2">{err}</div>}
        <button
          type="submit" disabled={submitting || !pin}
          className="mt-4 w-full text-white py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 hover:opacity-95 transition-opacity"
          style={{ background: C.accent }}
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
        <div className="mt-5 text-[10px] text-neutral-400 leading-snug">
          Interim PIN gate. Upgrading to NextAuth/Clerk before broader sharing — see <code>docs/FINANCE_ROUTE.md</code>.
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// Dashboard
// ============================================================================
const ALL_QUARTERS_2026 = ['2026Q1', '2026Q2', '2026Q3', '2026Q4'];

function Dashboard({ data, onLogout }: { data: DataResponse; onLogout: () => void }) {
  const cycles = data.cycles;
  const latest = cycles[0]; // most recent first
  const config = data.config;
  const agg = data.historyAggregates;

  // Group cycles by quarter
  const cyclesByQuarter = useMemo(() => {
    const groups = new Map<string, CycleRow[]>();
    for (const c of cycles) {
      if (!groups.has(c.quarter)) groups.set(c.quarter, []);
      groups.get(c.quarter)!.push(c);
    }
    groups.forEach(arr => arr.sort((a, b) => a.cycleEndDate.localeCompare(b.cycleEndDate)));
    return groups;
  }, [cycles]);

  // Pick the latest quarter that has data as the default selected
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() => {
    for (const q of [...ALL_QUARTERS_2026].reverse()) {
      if (cyclesByQuarter.get(q)?.length) return q;
    }
    return '2026Q1';
  });

  if (!latest || !config) {
    return (
      <div className="min-h-screen p-8" style={{ background: C.bg }}>
        <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm">
          <img src="/tanta-logo.png" alt="Tanta" className="w-32 h-auto mb-6" />
          <h1 className="text-lg font-semibold" style={{ color: C.accent }}>No data yet</h1>
          <p className="text-sm text-neutral-600 mt-2">
            Run <code className="bg-neutral-100 px-1 rounded">npm run finance:seed</code> to load the Q1 2026 baseline cycles.
          </p>
          <button onClick={onLogout} className="mt-4 text-xs text-neutral-500 hover:text-neutral-800">Log out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-12" style={{ background: C.bg }}>
      {/* Header strip with brand color */}
      <header className="border-b" style={{
        background: `linear-gradient(135deg, ${C.accent} 0%, ${C.accent2} 100%)`,
        borderColor: C.accent,
      }}>
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/tanta-logo-white.svg" alt="Tanta" className="h-8 w-auto opacity-90" />
            <div className="border-l border-white/30 pl-4">
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/70">Finance</div>
              <div className="text-base font-semibold text-white">Profit First Dashboard</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-white/60">Latest cycle</div>
              <div className="text-sm font-medium text-white">{latest.cycleEndDate}</div>
            </div>
            <button
              onClick={onLogout}
              className="text-[11px] uppercase tracking-wider text-white/70 hover:text-white px-3 py-1.5 rounded border border-white/30 hover:border-white/60 transition-colors"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {/* Top: split-screen — allocations | summary */}
        <section className="grid lg:grid-cols-2 gap-4">
          <HeroAllocations latest={latest} />
          <HeroSummary latest={latest} agg={agg} />
        </section>

        {/* Quarter tabs */}
        <QuarterTabs
          selected={selectedQuarter}
          onSelect={setSelectedQuarter}
          quartersWithData={cyclesByQuarter}
        />

        {/* Quarter dashboard */}
        <QuarterDashboard
          quarter={selectedQuarter}
          cycles={cyclesByQuarter.get(selectedQuarter) ?? []}
          allCapitalMovements={data.capitalMovements}
        />

        <footer className="pt-6 mt-8 border-t border-neutral-200 text-[11px] text-neutral-500 flex justify-between">
          <span>Tanta-Finance &middot; data canonical in Postgres &middot; snapshot exported to Drive on cycle close.</span>
          <span>TAPs effective from {config.effectiveFrom}</span>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// Hero — top split: Allocations (left) | Summary (right)
// ============================================================================
function HeroAllocations({ latest }: { latest: CycleRow }) {
  const a = latest.allocationsPrescribed;
  const sum = a.opex + a.salaries + a.tax + a.profit;
  const cycleIncome = latest.tradingIncomeCash;

  const rows = [
    { label: 'Opex',      pct: '50%', dest: '→ Opex 8.1K',                amount: a.opex },
    { label: 'Salaries',  pct: '45%', dest: '→ Drawings (split 50/50)',    amount: a.salaries },
    { label: 'Tax',       pct: '4%',  dest: '→ Tax (external)',            amount: a.tax },
    { label: 'Profit',    pct: '1%',  dest: '→ Profit (external)',         amount: a.profit },
  ];

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">Cycle income</div>
        <div className="text-[10px] uppercase tracking-wider text-neutral-400">
          {latest.cycleStartDate} → {latest.cycleEndDate}
        </div>
      </div>
      <div className="text-[28px] font-semibold tracking-tight tabular-nums" style={{ color: C.accent }}>
        {fmtMoneyExact(cycleIncome)}
      </div>

      <div className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 mt-5 mb-2">
        Allocations &mdash; transfers to make
      </div>
      <div className="divide-y divide-neutral-100">
        {rows.map(r => (
          <div key={r.label} className="flex items-center py-2.5 text-sm">
            <input type="checkbox" className="w-4 h-4 mr-3 rounded" style={{ accentColor: C.accent }} />
            <div className="flex-1 font-medium">{r.label}</div>
            <div className="w-10 text-[11px] text-neutral-400">{r.pct}</div>
            <div className="flex-1 text-[11px] text-neutral-500 ml-2">{r.dest}</div>
            <div className="w-28 text-right tabular-nums font-semibold" style={{ color: C.accent }}>
              {fmtMoneyExact(r.amount)}
            </div>
          </div>
        ))}
        <div className="flex items-center pt-3 mt-1 text-sm font-semibold border-t-2" style={{ borderColor: C.ink }}>
          <div className="w-7" />
          <div className="flex-1">Total</div>
          <div className="w-10 text-[11px] text-neutral-400">100%</div>
          <div className="flex-1" />
          <div className="w-28 text-right tabular-nums">{fmtMoneyExact(sum)}</div>
        </div>
      </div>
      <div className="mt-4 text-[10px] text-neutral-400 leading-snug">
        TAPs reviewed quarterly. Drawings = shareholder loan repayments (not salary).
      </div>
    </div>
  );
}

function HeroSummary({ latest, agg }: { latest: CycleRow; agg: FinanceSnapshot['history_aggregates'] }) {
  const trail = latest.trailIncome;
  const upfront = latest.upfrontIncome;
  const total = latest.tradingIncomeCash;
  const trailPct = total > 0 ? trail / total : 0;
  const drawings = latest.drawingsChris + latest.drawingsAnthony;
  const taxBal = latest.accountBalancesEnd['Tax (external)'] ?? latest.accountBalancesEnd['Tax'] ?? 0;
  const profitBal = latest.accountBalancesEnd['Profit (external)'] ?? latest.accountBalancesEnd['Profit'] ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 mb-1">Summary &middot; this cycle</div>
      <div className="text-[28px] font-semibold tracking-tight tabular-nums" style={{ color: C.accent }}>
        {fmtMoneyExact(total)}
      </div>
      <div className="flex items-baseline gap-3 mt-1 mb-4">
        <Pill colour={C.ok} label="trail">{fmtMoney(trail)} &middot; {fmtPct(trailPct)}</Pill>
        <Pill colour={C.accent2} label="upfront">{fmtMoney(upfront)}</Pill>
      </div>

      <div className="space-y-3 text-sm">
        <SummaryRow label="True operating expenses" value={fmtMoneyExact(latest.trueOpex)}
          hint={`vs ${fmtMoney(latest.allocationsActual.opex)} Opex deposit · ${total > 0 ? fmtPct(latest.trueOpex / total) : '—'} of income`} />
        <SummaryRow label="Drawings (shareholder loan repay)" value={fmtMoneyExact(drawings)}
          hint={`Chris ${fmtMoney(latest.drawingsChris)} · Anthony ${fmtMoney(latest.drawingsAnthony)} (50/50)`} />
        <SummaryRow label="Tax balance" value={fmtMoneyExact(taxBal)} hint="external bank" />
        <SummaryRow label="Profit balance" value={fmtMoneyExact(profitBal)} hint="external bank" />
        <SummaryRow label="Trail floor (3-mo annualised)"
          value={`${fmtMoney(agg.trail_floor_3mo)}/mo`}
          hint={`6-mo: ${fmtMoney(agg.trail_floor_6mo)}/mo · annualised ≈ ${fmtMoney(agg.trail_floor_3mo * 12)}/yr`} />
      </div>

      {latest.flags.length > 0 && (
        <div className="mt-5 pt-4 border-t border-neutral-100 space-y-2">
          {latest.flags.map((f, i) => <FlagInline key={i} f={f} />)}
        </div>
      )}
    </div>
  );
}

function Pill({ colour, label, children }: { colour: string; label: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1"
      style={{ background: colour + '14', color: colour }}
    >
      <span className="text-[9px] uppercase tracking-wider opacity-70">{label}</span>
      <span>{children}</span>
    </span>
  );
}

function SummaryRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <div className="text-neutral-500 text-[13px]">{label}</div>
      <div className="text-right">
        <div className="font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-[10px] text-neutral-400">{hint}</div>}
      </div>
    </div>
  );
}

function FlagInline({ f }: { f: CycleFlag }) {
  const colour = f.severity === 'bad' ? C.bad : f.severity === 'warn' ? C.warn : C.ok;
  return (
    <div className="border-l-[3px] pl-3 py-1" style={{ borderColor: colour }}>
      <div className="text-[12px] font-semibold">{f.title}</div>
      <div className="text-[12px] text-neutral-600 leading-snug">{f.body}</div>
    </div>
  );
}

// ============================================================================
// Quarter tabs
// ============================================================================
function QuarterTabs({
  selected, onSelect, quartersWithData,
}: {
  selected: string;
  onSelect: (q: string) => void;
  quartersWithData: Map<string, CycleRow[]>;
}) {
  const today = new Date();
  const currentQ = `${today.getFullYear()}Q${Math.floor(today.getMonth() / 3) + 1}`;

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-1 shadow-sm flex gap-1">
      {ALL_QUARTERS_2026.map(q => {
        const cycles = quartersWithData.get(q) ?? [];
        const hasData = cycles.length > 0;
        const isCurrent = q === currentQ;
        const isFuture = !hasData && !isCurrent && q > currentQ;
        const isSelected = q === selected;
        const label = q.replace('2026Q', 'Q');

        return (
          <button
            key={q}
            onClick={() => !isFuture && onSelect(q)}
            disabled={isFuture}
            className={`
              flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-all
              ${isSelected
                ? 'shadow-sm'
                : isFuture
                  ? 'cursor-not-allowed opacity-40'
                  : 'hover:bg-neutral-50'}
            `}
            style={{
              background: isSelected ? C.accent : 'transparent',
              color: isSelected ? 'white' : isFuture ? C.muted : C.ink,
            }}
          >
            <div className="flex items-center justify-center gap-2">
              <span>{label} 2026</span>
              {isCurrent && hasData && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: isSelected ? 'rgba(255,255,255,0.18)' : C.warn + '22', color: isSelected ? 'white' : C.warn }}>
                  In progress
                </span>
              )}
              {isCurrent && !hasData && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: C.warn + '22', color: C.warn }}>
                  Current
                </span>
              )}
            </div>
            <div className="text-[10px] font-normal mt-0.5"
                 style={{ color: isSelected ? 'rgba(255,255,255,0.8)' : C.muted }}>
              {hasData ? `${cycles.length} ${cycles.length === 1 ? 'cycle' : 'cycles'}` : isFuture ? 'Not started' : 'No data yet'}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Quarter dashboard — boardroom-grade per-quarter view
// ============================================================================
function QuarterDashboard({
  quarter, cycles, allCapitalMovements,
}: {
  quarter: string;
  cycles: CycleRow[];
  allCapitalMovements: CapitalMovement[];
}) {
  const qLabel = quarter.replace('2026Q', 'Q');
  const today = new Date();
  const currentQ = `${today.getFullYear()}Q${Math.floor(today.getMonth() / 3) + 1}`;
  const isInProgress = quarter === currentQ;

  if (cycles.length === 0) {
    return (
      <section className="bg-white rounded-2xl border border-neutral-200 p-12 shadow-sm text-center">
        <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">{qLabel} 2026</div>
        <div className="text-lg font-semibold mt-1 mb-2" style={{ color: C.accent }}>
          {isInProgress ? 'No cycles closed yet this quarter' : 'Quarter not started'}
        </div>
        <div className="text-sm text-neutral-500 max-w-md mx-auto leading-relaxed">
          {isInProgress
            ? 'This tab will populate as fortnightly cycles close. The first cycle of each quarter is when the quarterly TAP review + Profit Distribution decision happen.'
            : 'Future quarters open as cycles close. The dashboard surfaces income composition, allocation execution, true Opex burn, capital movements, and decisions for the catch-up.'}
        </div>
      </section>
    );
  }

  // Aggregates
  const totalIncome = cycles.reduce((s, c) => s + c.tradingIncomeCash, 0);
  const totalTrail = cycles.reduce((s, c) => s + c.trailIncome, 0);
  const totalUpfront = cycles.reduce((s, c) => s + c.upfrontIncome, 0);
  const totalOpex = cycles.reduce((s, c) => s + c.trueOpex, 0);
  const totalDrawings = cycles.reduce((s, c) => s + c.drawingsChris + c.drawingsAnthony, 0);
  const trailPct = totalIncome > 0 ? totalTrail / totalIncome : 0;
  const opexPct  = totalIncome > 0 ? totalOpex  / totalIncome : 0;
  const drawPct  = totalIncome > 0 ? totalDrawings / totalIncome : 0;

  // Income composition by source × type (aggregated)
  const sourceAgg: Record<string, { trail: number; upfront: number; refix: number; clawback: number }> = {};
  for (const c of cycles) {
    for (const [src, breakdown] of Object.entries(c.incomeBySource)) {
      sourceAgg[src] = sourceAgg[src] ?? { trail: 0, upfront: 0, refix: 0, clawback: 0 };
      sourceAgg[src].trail    += breakdown.trail    ?? 0;
      sourceAgg[src].upfront  += breakdown.upfront  ?? 0;
      sourceAgg[src].refix    += breakdown.refix    ?? 0;
      sourceAgg[src].clawback += breakdown.clawback ?? 0;
    }
  }
  const sourceLabels = Object.keys(sourceAgg).sort((a, b) => {
    const ta = sourceAgg[a].trail + sourceAgg[a].upfront;
    const tb = sourceAgg[b].trail + sourceAgg[b].upfront;
    return tb - ta;
  });

  // Capital movements scoped to this quarter
  const qCapital = allCapitalMovements.filter(m => {
    const date = new Date(m.movementDate);
    const y = date.getFullYear();
    const q = Math.floor(date.getMonth() / 3) + 1;
    return `${y}Q${q}` === quarter;
  });

  return (
    <section className="space-y-5">
      {/* Quarter header strip */}
      <div className="bg-white rounded-2xl border border-neutral-200 px-6 py-4 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-neutral-400">Quarter</div>
          <div className="text-xl font-semibold mt-0.5" style={{ color: C.accent }}>
            {qLabel} 2026 {isInProgress && <span className="text-xs font-normal ml-2 px-2 py-0.5 rounded" style={{ background: C.warn + '22', color: C.warn }}>In progress</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Cycles in quarter</div>
          <div className="text-base font-semibold tabular-nums">{cycles.length}{isInProgress ? ' / 6 expected' : ''}</div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Trading income" value={fmtMoney(totalIncome)} hint={`${cycles.length} ${cycles.length === 1 ? 'cycle' : 'cycles'} · avg ${fmtMoney(totalIncome / cycles.length)}/cycle`} accent={C.accent} />
        <KpiCard label="Trail income" value={fmtMoney(totalTrail)} hint={`${fmtPct(trailPct)} of income · recurring`} accent={C.ok} />
        <KpiCard label="True Opex burn" value={fmtPct(opexPct)} hint={`${fmtMoney(totalOpex)} actual operating spend`} accent={C.warn} />
        <KpiCard label="Drawings" value={fmtPct(drawPct)} hint={`${fmtMoney(totalDrawings)} (Chris + Anthony, 50/50)`} accent={C.bad} />
      </div>

      {/* Charts row 1 — Income trend + composition */}
      <div className="grid lg:grid-cols-5 gap-4">
        <ChartCard title="Income by cycle" className="lg:col-span-3">
          <Bar
            data={{
              labels: cycles.map(c => c.cycleEndDate.slice(5)),
              datasets: [
                { label: 'Trail',   data: cycles.map(c => c.trailIncome),   backgroundColor: C.ok      },
                { label: 'Upfront', data: cycles.map(c => c.upfrontIncome), backgroundColor: C.accent  },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
                tooltip: {
                  callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoneyExact(Number(ctx.raw))}` },
                },
              },
              scales: {
                x: { stacked: true, grid: { display: false } },
                y: {
                  stacked: true,
                  ticks: { callback: (v) => fmtMoneyShort(Number(v)), font: { size: 10 } },
                  grid: { color: '#f0efe8' },
                },
              },
            }}
          />
        </ChartCard>

        <ChartCard title="Income by source" className="lg:col-span-2">
          <Doughnut
            data={{
              labels: sourceLabels,
              datasets: [{
                data: sourceLabels.map(s => {
                  const a = sourceAgg[s];
                  return Math.max(0, a.trail + a.upfront + a.refix + a.clawback);
                }),
                backgroundColor: [C.accent, C.ok, C.accent2, C.warn, C.capital, '#a8c2dc', C.muted, '#cccccc'],
                borderWidth: 0,
              }],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 }, padding: 8 } },
                tooltip: {
                  callbacks: { label: (ctx) => `${ctx.label}: ${fmtMoneyExact(Number(ctx.raw))}` },
                },
              },
            }}
          />
        </ChartCard>
      </div>

      {/* Charts row 2 — Opex burn + drawings */}
      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="True Opex vs allocated">
          <Bar
            data={{
              labels: cycles.map(c => c.cycleEndDate.slice(5)),
              datasets: [
                { label: 'Opex deposit (50%)',          data: cycles.map(c => c.allocationsActual.opex), backgroundColor: '#dee5ef' },
                { label: 'True operating expenses', data: cycles.map(c => c.trueOpex),                  backgroundColor: C.bad },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoneyExact(Number(ctx.raw))}` } },
              },
              scales: {
                x: { grid: { display: false } },
                y: { ticks: { callback: (v) => fmtMoneyShort(Number(v)), font: { size: 10 } }, grid: { color: '#f0efe8' } },
              },
            }}
          />
        </ChartCard>

        <ChartCard title="Drawings vs Salaries TAP">
          <Bar
            data={{
              labels: cycles.map(c => c.cycleEndDate.slice(5)),
              datasets: [
                { label: 'Salaries TAP (45%)', data: cycles.map(c => c.allocationsActual.salaries),     backgroundColor: '#dee5ef' },
                { label: 'Actual drawings',    data: cycles.map(c => c.drawingsChris + c.drawingsAnthony), backgroundColor: C.bad },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoneyExact(Number(ctx.raw))}` } },
              },
              scales: {
                x: { grid: { display: false } },
                y: { ticks: { callback: (v) => fmtMoneyShort(Number(v)), font: { size: 10 } }, grid: { color: '#f0efe8' } },
              },
            }}
          />
        </ChartCard>
      </div>

      {/* Allocation execution table */}
      <DataCard title="Allocation execution &mdash; prescribed vs actual">
        <div className="overflow-hidden rounded-xl border border-neutral-200">
          <table className="w-full text-xs">
            <thead style={{ background: C.soft }}>
              <tr>
                <Th>Cycle</Th>
                <Th align="right">Income</Th>
                <Th align="right">Opex</Th>
                <Th align="right">Salaries</Th>
                <Th align="right">Tax</Th>
                <Th align="right">Profit</Th>
                <Th align="right">Trail %</Th>
              </tr>
            </thead>
            <tbody>
              {cycles.map(c => {
                const trailPct = c.tradingIncomeCash > 0 ? c.trailIncome / c.tradingIncomeCash : 0;
                return (
                  <tr key={c.cycleEndDate} className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors">
                    <Td><span className="font-medium">{c.cycleEndDate}</span></Td>
                    <Td align="right" mono>{fmtMoney(c.tradingIncomeCash)}</Td>
                    <Td align="right" mono>{fmtMoney(c.allocationsActual.opex)}</Td>
                    <Td align="right" mono>{fmtMoney(c.allocationsActual.salaries)}</Td>
                    <Td align="right" mono>{fmtMoney(c.allocationsActual.tax)}</Td>
                    <Td align="right" mono>{fmtMoney(c.allocationsActual.profit)}</Td>
                    <Td align="right" mono className="text-[color:var(--ok)]" style={{ color: C.ok }}>{fmtPct(trailPct)}</Td>
                  </tr>
                );
              })}
              <tr className="border-t-2" style={{ borderColor: C.ink, background: C.soft }}>
                <Td><strong>Total</strong></Td>
                <Td align="right" mono><strong>{fmtMoney(totalIncome)}</strong></Td>
                <Td align="right" mono><strong>{fmtMoney(cycles.reduce((s, c) => s + c.allocationsActual.opex, 0))}</strong></Td>
                <Td align="right" mono><strong>{fmtMoney(cycles.reduce((s, c) => s + c.allocationsActual.salaries, 0))}</strong></Td>
                <Td align="right" mono><strong>{fmtMoney(cycles.reduce((s, c) => s + c.allocationsActual.tax, 0))}</strong></Td>
                <Td align="right" mono><strong>{fmtMoney(cycles.reduce((s, c) => s + c.allocationsActual.profit, 0))}</strong></Td>
                <Td align="right" mono><strong>{fmtPct(trailPct)}</strong></Td>
              </tr>
            </tbody>
          </table>
        </div>
      </DataCard>

      {/* Capital movements (this quarter) */}
      {qCapital.length > 0 && (
        <DataCard title="Capital movements (NOT trading income)" accent={C.capital}>
          <div className="overflow-hidden rounded-xl border border-neutral-200">
            <table className="w-full text-xs">
              <thead style={{ background: C.capital + '12' }}>
                <tr>
                  <Th>Date</Th>
                  <Th>Kind</Th>
                  <Th align="right">Amount</Th>
                  <Th>Description</Th>
                </tr>
              </thead>
              <tbody>
                {qCapital.map(m => (
                  <tr key={m.id} className="border-t border-neutral-100">
                    <Td><span className="font-medium">{m.movementDate}</span></Td>
                    <Td><span className="text-neutral-600">{m.kind.replace(/_/g, ' ')}</span></Td>
                    <Td align="right" mono className={m.amount >= 0 ? '' : ''}>
                      <span style={{ color: m.amount >= 0 ? C.ok : C.bad, fontWeight: 600 }}>
                        {m.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(m.amount))}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-neutral-600">{m.description}</span>
                      {m.payeeOrPayer && <span className="text-neutral-400"> · {m.payeeOrPayer}</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataCard>
      )}
    </section>
  );
}

// ============================================================================
// Atoms
// ============================================================================
function KpiCard({ label, value, hint, accent }: { label: string; value: string; hint: string; accent: string }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ background: accent }} />
      <div className="pl-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-neutral-400">{label}</div>
        <div className="text-[22px] font-semibold tracking-tight tabular-nums mt-0.5" style={{ color: C.ink }}>{value}</div>
        <div className="text-[10px] text-neutral-500 mt-1 leading-snug">{hint}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm ${className}`}>
      <div className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 mb-3">{title}</div>
      <div style={{ height: 220 }}>{children}</div>
    </div>
  );
}

function DataCard({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.16em] mb-3"
           style={{ color: accent ?? C.muted }}
           dangerouslySetInnerHTML={{ __html: title }} />
      {children}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 text-[10px] uppercase tracking-wider font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}
        style={{ color: C.accent }}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', mono = false, className = '', style }: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <td className={`px-3 py-2 ${align === 'right' ? 'text-right' : ''} ${mono ? 'tabular-nums' : ''} ${className}`} style={style}>
      {children}
    </td>
  );
}
