'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CycleRow,
  FinanceConfig,
  CapitalMovement,
  FinanceSnapshot,
} from '@/app/lib/finance-types';

type DataResponse = {
  cycles: CycleRow[];
  config: FinanceConfig | null;
  capitalMovements: CapitalMovement[];
  historyAggregates: FinanceSnapshot['history_aggregates'];
};

const fmtMoney = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-NZ');

const fmtMoneyExact = (n: number) =>
  '$' + n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPct = (n: number) => (n * 100).toFixed(1) + '%';

export default function FinancePage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [data, setData] = useState<DataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    const res = await fetch('/api/finance-data', { cache: 'no-store' });
    if (res.status === 401) {
      setUnlocked(false);
      return;
    }
    if (!res.ok) {
      setError(`Server returned ${res.status}`);
      return;
    }
    const body = (await res.json()) as DataResponse;
    setData(body);
    setUnlocked(true);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (unlocked === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }

  if (!unlocked) {
    return <PinGate onUnlocked={fetchData} />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">
        Loading data…
      </div>
    );
  }

  return <Dashboard data={data} onLogout={() => {
    fetch('/api/finance-unlock', { method: 'DELETE' }).then(() => setUnlocked(false));
  }} />;
}

// --------------------------------------------------------------------------
// PIN gate
// --------------------------------------------------------------------------

function PinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch('/api/finance-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        onUnlocked();
      } else if (res.status === 401) {
        setErr('Incorrect PIN');
      } else {
        setErr(`Server returned ${res.status}`);
      }
    } finally {
      setSubmitting(false);
    }
  }, [pin, onUnlocked]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-sm border border-neutral-200 p-8 w-full max-w-sm">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">Tanta finance</div>
        <h1 className="text-xl font-semibold text-[#1d3557] mb-4">Enter PIN</h1>
        <input
          type="password"
          value={pin}
          onChange={e => setPin(e.target.value)}
          autoFocus
          className="w-full px-3 py-2 rounded-md border border-neutral-300 text-base font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-[#1d3557] focus:border-transparent"
          placeholder="••••"
        />
        {err && <div className="text-xs text-red-700 mt-2">{err}</div>}
        <button
          type="submit"
          disabled={submitting || !pin}
          className="mt-4 w-full bg-[#1d3557] text-white py-2 rounded-md text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
        <div className="mt-4 text-[11px] text-neutral-500 leading-snug">
          PIN-based gate is interim. Upgrade to NextAuth/Clerk before this is widely shared. See <code>integrations/xero.md</code> + the architecture memo.
        </div>
      </form>
    </div>
  );
}

// --------------------------------------------------------------------------
// Dashboard (keeps allocations as the top line per Chris's preference,
// per `reference_tanta_finance_design_principles.md`)
// --------------------------------------------------------------------------

function Dashboard({ data, onLogout }: { data: DataResponse; onLogout: () => void }) {
  const cycles = data.cycles;
  const latest = cycles[0];
  const config = data.config;
  const agg = data.historyAggregates;

  if (!latest || !config) {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-3xl mx-auto bg-white rounded-lg border border-neutral-200 p-6">
          <h1 className="text-lg font-semibold text-[#1d3557]">No data yet</h1>
          <p className="text-sm text-neutral-600 mt-2">
            Run <code>npm run finance:seed</code> to load the Q1 2026 baseline cycles, or wait for the
            next cycle ingestion. The page will populate automatically once <code>finance_cycles</code> has rows.
          </p>
          <button onClick={onLogout} className="mt-4 text-xs text-neutral-500 hover:text-neutral-800">Log out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1a1a1a]">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <header className="border-b-2 border-neutral-900 pb-3 mb-6 flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tanta Finance</h1>
            <div className="text-xs text-neutral-500 mt-1">
              Latest cycle: {latest.cycleEndDate} · {cycles.length} cycles loaded · TAPs effective from {config.effectiveFrom}
            </div>
          </div>
          <button onClick={onLogout} className="text-xs text-neutral-500 hover:text-neutral-800">Log out</button>
        </header>

        {/* Allocations — TOP LINE per design principle */}
        <Allocations latest={latest} />

        {/* Summary card */}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#1d3557] border-b border-neutral-200 pb-1 mt-8 mb-3">
          Summary &middot; this cycle vs trend
        </h2>
        <SummaryCard latest={latest} agg={agg} />

        {/* Flags */}
        {latest.flags.length > 0 && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#1d3557] border-b border-neutral-200 pb-1 mt-8 mb-3">
              Flags this cycle
            </h2>
            <FlagsList flags={latest.flags} />
          </>
        )}

        {/* Recent cycles table */}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#1d3557] border-b border-neutral-200 pb-1 mt-8 mb-3">
          Recent cycles
        </h2>
        <CycleTable cycles={cycles} />

        {/* Capital movements */}
        {data.capitalMovements.length > 0 && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#1d3557] border-b border-neutral-200 pb-1 mt-8 mb-3">
              Capital movements (NOT trading income)
            </h2>
            <CapitalTable movements={data.capitalMovements} />
          </>
        )}

        <footer className="mt-12 pt-4 border-t border-neutral-200 text-[11px] text-neutral-500">
          Tanta-Finance dashboard &middot; data canonical in Postgres &middot; snapshot exported to Drive for Cowork on each cycle close.
        </footer>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Components
// --------------------------------------------------------------------------

function Allocations({ latest }: { latest: CycleRow }) {
  const a = latest.allocationsPrescribed;
  const sum = a.opex + a.salaries + a.tax + a.profit;
  const cycleIncome = latest.tradingIncomeCash;

  return (
    <div className="bg-white border border-neutral-200 rounded-md p-5">
      <div className="flex items-baseline gap-3 mb-3">
        <div className="text-2xl font-semibold tracking-tight">{fmtMoneyExact(cycleIncome)}</div>
        <div className="text-xs text-neutral-500">cycle income · {latest.cycleStartDate} → {latest.cycleEndDate}</div>
      </div>

      <div className="text-[11px] uppercase tracking-wider text-[#1d3557] font-semibold mb-2">Allocations — transfers to make</div>
      <div className="divide-y divide-neutral-200">
        <AllocationRow label="Opex" pct="50%" dest="→ Opex 8.1K" amount={a.opex} />
        <AllocationRow label="Salaries" pct="45%" dest="→ Drawings (split 50/50 from Opex)" amount={a.salaries} />
        <AllocationRow label="Tax" pct="4%" dest="→ Tax (external)" amount={a.tax} />
        <AllocationRow label="Profit" pct="1%" dest="→ Profit (external)" amount={a.profit} />
        <div className="flex items-center pt-2 mt-2 border-t border-neutral-900 text-sm font-semibold">
          <div className="w-5"></div>
          <div className="flex-1">Total</div>
          <div className="w-12 text-xs text-neutral-500">100%</div>
          <div className="flex-1"></div>
          <div className="w-28 text-right tabular-nums">{fmtMoneyExact(sum)}</div>
        </div>
      </div>
      <div className="mt-3 text-[11px] text-neutral-500">
        TAPs reviewed quarterly. Drawings = shareholder loan repayments (not salary). See <code>profit_first_taps.md</code>.
      </div>
    </div>
  );
}

function AllocationRow({ label, pct, dest, amount }: { label: string; pct: string; dest: string; amount: number }) {
  return (
    <div className="flex items-center py-2 text-sm">
      <input type="checkbox" className="w-4 h-4 mr-3 accent-[#1d3557]" />
      <div className="flex-1 font-medium">{label}</div>
      <div className="w-12 text-xs text-neutral-500">{pct}</div>
      <div className="flex-1 text-xs text-neutral-500">{dest}</div>
      <div className="w-28 text-right tabular-nums font-medium text-[#1d3557]">{fmtMoneyExact(amount)}</div>
    </div>
  );
}

function SummaryCard({ latest, agg }: { latest: CycleRow; agg: FinanceSnapshot['history_aggregates'] }) {
  const trail = latest.trailIncome;
  const upfront = latest.upfrontIncome;
  const total = latest.tradingIncomeCash;
  const trailPct = total > 0 ? trail / total : 0;
  const drawings = latest.drawingsChris + latest.drawingsAnthony;
  const taxBal = latest.accountBalancesEnd['Tax'] ?? latest.accountBalancesEnd['Tax (external)'] ?? 0;
  const profitBal = latest.accountBalancesEnd['Profit'] ?? latest.accountBalancesEnd['Profit (external)'] ?? 0;

  return (
    <div className="bg-white border border-neutral-200 rounded-md p-4">
      <Row label="Cycle income" value={fmtMoneyExact(total)} hint={`Trail ${fmtMoneyExact(trail)} (${fmtPct(trailPct)}) · Upfront ${fmtMoneyExact(upfront)}`} />
      <Row label="True expenses (operating)" value={fmtMoneyExact(latest.trueOpex)} hint={`vs cycle Opex deposit ${fmtMoneyExact(latest.allocationsActual.opex)}`} />
      <Row label="Drawings" value={fmtMoneyExact(drawings)} hint={`Chris ${fmtMoneyExact(latest.drawingsChris)} · Anthony ${fmtMoneyExact(latest.drawingsAnthony)} (50/50 policy)`} />
      <Row label="Tax balance" value={fmtMoneyExact(taxBal)} hint="external bank" />
      <Row label="Profit balance" value={fmtMoneyExact(profitBal)} hint="external bank" />
      <Row label="Trail floor (3-mo annualised)" value={fmtMoneyExact(agg.trail_floor_3mo) + '/mo'} hint={`6-mo: ${fmtMoneyExact(agg.trail_floor_6mo)}/mo`} />
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex justify-between items-baseline py-1.5 text-sm border-b border-neutral-100 last:border-b-0">
      <div className="text-neutral-500">{label}</div>
      <div className="text-right">
        <span className="font-medium tabular-nums">{value}</span>
        {hint && <div className="text-[11px] text-neutral-500">{hint}</div>}
      </div>
    </div>
  );
}

function FlagsList({ flags }: { flags: CycleRow['flags'] }) {
  const colour = (s: 'ok' | 'warn' | 'bad') =>
    s === 'bad' ? 'border-l-[#9b2226]' : s === 'warn' ? 'border-l-[#b67c00]' : 'border-l-[#2d6a4f]';
  return (
    <div className="space-y-2">
      {flags.map((f, i) => (
        <div key={i} className={`bg-white border border-neutral-200 ${colour(f.severity)} border-l-4 rounded p-3`}>
          <div className="font-semibold text-sm">{f.title}</div>
          <div className="text-sm text-neutral-700 mt-0.5">{f.body}</div>
        </div>
      ))}
    </div>
  );
}

function CycleTable({ cycles }: { cycles: CycleRow[] }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-[#f1f3f8] text-[#1d3557]">
          <tr>
            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Cycle</th>
            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider">Income (cash)</th>
            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider">Trail</th>
            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider">True Opex</th>
            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider">Drawings</th>
            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider">Trail %</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map(c => {
            const drawings = c.drawingsChris + c.drawingsAnthony;
            const trailPct = c.tradingIncomeCash > 0 ? c.trailIncome / c.tradingIncomeCash : 0;
            return (
              <tr key={c.cycleEndDate} className="border-t border-neutral-100">
                <td className="px-3 py-2 font-medium">{c.cycleEndDate}</td>
                <td className="text-right tabular-nums px-3 py-2">{fmtMoney(c.tradingIncomeCash)}</td>
                <td className="text-right tabular-nums px-3 py-2 text-[#2d6a4f]">{fmtMoney(c.trailIncome)}</td>
                <td className="text-right tabular-nums px-3 py-2">{fmtMoney(c.trueOpex)}</td>
                <td className="text-right tabular-nums px-3 py-2">{fmtMoney(drawings)}</td>
                <td className="text-right tabular-nums px-3 py-2">{fmtPct(trailPct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CapitalTable({ movements }: { movements: CapitalMovement[] }) {
  const kindLabel = (k: string) => k.replace(/_/g, ' ');
  return (
    <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-[#f3edfa] text-[#8a6fa8]">
          <tr>
            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Date</th>
            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Kind</th>
            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider">Amount</th>
            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Description</th>
          </tr>
        </thead>
        <tbody>
          {movements.map(m => (
            <tr key={m.id} className="border-t border-neutral-100">
              <td className="px-3 py-2 font-medium">{m.movementDate}</td>
              <td className="px-3 py-2 text-neutral-600">{kindLabel(m.kind)}</td>
              <td className={`text-right tabular-nums px-3 py-2 ${m.amount >= 0 ? 'text-[#2d6a4f]' : 'text-[#9b2226]'}`}>
                {m.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(m.amount))}
              </td>
              <td className="px-3 py-2 text-neutral-600">{m.description ?? ''} {m.payeeOrPayer ? `· ${m.payeeOrPayer}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
