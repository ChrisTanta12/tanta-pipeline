'use client';

import './styles.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CycleRow,
  FinanceConfig,
  CapitalMovement,
  FinanceSnapshot,
} from '@/app/lib/finance-types';

/* ============================================================================
   /finance — design v2 (Claude design handoff, May 2026)
   Single page; both fortnightly and quarterly views stack on one canvas.
   See app/finance/styles.css for the visual styling.
   ============================================================================ */

type DataResponse = {
  cycles: CycleRow[];
  config: FinanceConfig | null;
  capitalMovements: CapitalMovement[];
  historyAggregates: FinanceSnapshot['history_aggregates'];
};

const ALL_QUARTERS_2026 = ['2026Q1', '2026Q2', '2026Q3', '2026Q4'];

// ---------- Format helpers ----------
function splitMoney(n: number): { whole: string; cents: string } {
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const c = Math.round((abs - whole) * 100);
  return {
    whole: (neg ? '-' : '') + '$' + whole.toLocaleString('en-NZ'),
    cents: '.' + String(c).padStart(2, '0'),
  };
}
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('en-NZ');
const fmtMoneyK = (n: number) => {
  const v = n / 1000;
  return '$' + (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) + 'k';
};
const fmtPct1 = (n: number) => (n * 100).toFixed(1) + '%';

function Money({ n }: { n: number }) {
  const { whole, cents } = splitMoney(n);
  return (
    <span>
      {whole}
      <span className="cents">{cents}</span>
    </span>
  );
}

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

  if (unlocked === null) return <div className="tanta-finance-root"><div className="loading">Loading…</div></div>;
  if (!unlocked) return <PinGate onUnlocked={fetchData} />;
  if (error) return <div className="tanta-finance-root"><div className="loading" style={{ color: '#9b2226' }}>{error}</div></div>;
  if (!data) return <div className="tanta-finance-root"><div className="loading">Loading data…</div></div>;

  return (
    <div className="tanta-finance-root">
      <Dashboard data={data} onLogout={() => {
        fetch('/api/finance-unlock', { method: 'DELETE' }).then(() => setUnlocked(false));
      }} />
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
    <div className="tanta-finance-root">
      <div className="pin-gate-wrap">
        <form onSubmit={submit} className="pin-gate">
          <img src="/tanta-logo.png" alt="Tanta" />
          <div className="pg-eyebrow">Internal · Finance</div>
          <h1>Enter PIN</h1>
          <input type="password" value={pin} onChange={e => setPin(e.target.value)} autoFocus placeholder="••••" />
          {err && <div className="err">{err}</div>}
          <button type="submit" disabled={submitting || !pin}>{submitting ? 'Checking…' : 'Unlock'}</button>
          <div className="footnote">Interim PIN gate. Upgrading to NextAuth/Clerk before broader sharing — see <code>docs/FINANCE_ROUTE.md</code>.</div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// Dashboard
// ============================================================================
function Dashboard({ data, onLogout }: { data: DataResponse; onLogout: () => void }) {
  const cycles = data.cycles;

  // Group cycles by quarter
  const cyclesByQuarter = useMemo(() => {
    const groups = new Map<string, CycleRow[]>();
    for (const c of cycles) {
      if (!groups.has(c.quarter)) groups.set(c.quarter, []);
      groups.get(c.quarter)!.push(c);
    }
    // ascending within quarter
    groups.forEach(arr => arr.sort((a, b) => a.cycleEndDate.localeCompare(b.cycleEndDate)));
    return groups;
  }, [cycles]);

  // Default selected = latest quarter that has data
  const defaultQuarter = useMemo(() => {
    for (const q of [...ALL_QUARTERS_2026].reverse()) {
      if (cyclesByQuarter.get(q)?.length) return q;
    }
    return '2026Q1';
  }, [cyclesByQuarter]);

  const [selectedQuarter, setSelectedQuarter] = useState<string>(defaultQuarter);
  const quarterCycles = cyclesByQuarter.get(selectedQuarter) ?? [];
  const latestInQuarter = quarterCycles[quarterCycles.length - 1] ?? cycles[0];

  if (!latestInQuarter || !data.config) {
    return (
      <div className="page" style={{ padding: 32 }}>
        <div className="alloc">
          <h2 style={{ margin: 0, fontFamily: "'Manrope', sans-serif", fontSize: 22, color: 'var(--accent)' }}>No data yet</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            Run <code>npm run finance:seed</code> to load the Q1 2026 baseline fortnights.
          </p>
          <button onClick={onLogout} style={{ background: 'none', border: 0, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>Log out</button>
        </div>
      </div>
    );
  }

  const qLabel = selectedQuarter.replace('2026Q', 'Q');
  const today = new Date();
  const currentQ = `${today.getFullYear()}Q${Math.floor(today.getMonth() / 3) + 1}`;
  const isCurrent = selectedQuarter === currentQ;

  return (
    <>
      <AppHeader latestCycle={latestInQuarter.cycleEndDate} quarter={qLabel} onLogout={onLogout} />
      <QuarterTabs
        active={selectedQuarter}
        onSelect={setSelectedQuarter}
        cyclesByQuarter={cyclesByQuarter}
      />

      <div className="page">
        {/* ─── Fortnightly view ─── */}
        <div className="section-head">
          <div>
            <div className="eyebrow">Fortnightly · 60-second read</div>
            <h2>Fortnight ending {formatLongDate(latestInQuarter.cycleEndDate)}</h2>
          </div>
          <div className="section-meta">
            Fortnight {quarterCycles.indexOf(latestInQuarter) + 1} of {quarterCycles.length}
            {isCurrent ? ' · in progress' : ` · last fortnight of ${qLabel} 2026`}
          </div>
        </div>

        <div className="split">
          <AllocationsPanel cycle={latestInQuarter} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <SummaryPanel cycle={latestInQuarter} agg={data.historyAggregates} />
            <GrowthFortnightly />
          </div>
        </div>

        {/* ─── Quarterly review ─── */}
        <div className="section-head">
          <div>
            <div className="eyebrow">Quarterly review · 5–10 minutes</div>
            <h2>{qLabel} 2026 — {quarterRangeLabel(selectedQuarter)}</h2>
          </div>
          <div className="section-meta">
            {quarterCycles.length} {quarterCycles.length === 1 ? 'fortnight' : 'fortnights'}
            {isCurrent ? ' · in progress' : ` · closed ${formatLongDate(latestInQuarter.cycleEndDate)} · TAP review due`}
          </div>
        </div>

        <KPIStrip cycles={quarterCycles} />
        <GrowthQuarter />

        <div className="charts-grid">
          <IncomeByCycleChart cycles={quarterCycles} />
          <IncomeBySourceChart cycles={quarterCycles} />
        </div>

        <DisciplinePanel cycles={quarterCycles} />
        <AllocationTable cycles={quarterCycles} />
        <CapitalTable
          movements={data.capitalMovements.filter(m => quarterFromDate(m.movementDate) === selectedQuarter)}
        />

        <div className="footer-meta">
          <span>Tanta-Finance · Postgres canonical · Cowork reads a snapshot for conversational analysis.</span>
          <span>TAPs effective from {data.config.effectiveFrom}</span>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Header + tabs
// ============================================================================
function AppHeader({ latestCycle, quarter, onLogout }: { latestCycle: string; quarter: string; onLogout: () => void }) {
  return (
    <header className="app-header">
      <div className="brand">
        <img src="/tanta-logo-white.svg" alt="Tanta" />
      </div>
      <div className="header-divider" />
      <div>
        <div className="crumb">Internal · Finance</div>
        <div className="title">Money catch-up</div>
      </div>
      <div className="spacer" />
      <div className="meta">
        Latest fortnight <strong>{formatLongDate(latestCycle)}</strong> · <span>{quarter} 2026</span>
      </div>
      <button onClick={onLogout} className="logout">Sign out</button>
    </header>
  );
}

function QuarterTabs({
  active, onSelect, cyclesByQuarter,
}: {
  active: string;
  onSelect: (q: string) => void;
  cyclesByQuarter: Map<string, CycleRow[]>;
}) {
  const today = new Date();
  const currentQ = `${today.getFullYear()}Q${Math.floor(today.getMonth() / 3) + 1}`;

  const tabs = ALL_QUARTERS_2026.map(q => {
    const qcycles = cyclesByQuarter.get(q) ?? [];
    const hasData = qcycles.length > 0;
    const isCurrent = q === currentQ;
    const isFuture = !hasData && q > currentQ;
    const label = q.replace('2026Q', 'Q');
    let sub = '';
    if (q === active) {
      const range = quarterRangeLabel(q);
      if (isCurrent) sub = `${range} · ${qcycles.length} of 6 · in progress`;
      else if (hasData) sub = `${range} · ${qcycles.length} fortnights · closed`;
      else sub = `${range} · no data yet`;
    }
    let state: 'active' | 'past' | 'future' = 'past';
    if (q === active) state = 'active';
    else if (isFuture) state = 'future';
    return { q: label, fullQ: q, state, sub, isFuture };
  });

  return (
    <div className="qtabs">
      {tabs.map(t => (
        <button
          key={t.fullQ}
          className="qtab"
          data-state={t.state}
          onClick={() => !t.isFuture && onSelect(t.fullQ)}
          type="button"
        >
          <span>{t.q} 2026</span>
          {t.state === 'active' && <span className="qtab-meta">· {t.sub}</span>}
          {t.state === 'future' && <span className="qtab-meta">· opens {futureOpensLabel(t.fullQ)}</span>}
        </button>
      ))}
      <div className="qtabs-spacer" />
      <div className="qtabs-side">Profit First · TAPs reviewed quarterly</div>
    </div>
  );
}

// ============================================================================
// Allocations panel (the action)
// ============================================================================
function AllocationsPanel({ cycle }: { cycle: CycleRow }) {
  const a = cycle.allocationsActual;
  const sum = a.opex + a.salaries + a.tax + a.profit;
  const halfSalaries = a.salaries / 2;
  const isLowCycle = cycle.tradingIncomeCash < 2000;
  const trailPct = cycle.tradingIncomeCash > 0 ? cycle.trailIncome / cycle.tradingIncomeCash : 0;
  const upfrontPct = cycle.tradingIncomeCash > 0 ? cycle.upfrontIncome / cycle.tradingIncomeCash : 0;

  const rows = [
    {
      key: 'opex', name: 'Opex', pct: '50%',
      dest: 'Opex 8.1K',
      amount: a.opex, checked: true, muted: false,
    },
    {
      key: 'sal', name: 'Drawings', pct: '45% (Salaries TAP)',
      dest: `Chris ${fmtMoney(halfSalaries)}  ·  Anthony ${fmtMoney(halfSalaries)}`,
      amount: a.salaries, checked: true, muted: false,
    },
    {
      key: 'tax', name: 'Tax', pct: '4%',
      dest: a.tax === 0 ? 'Tax (external) — non-standard fortnight, see flag' : 'Tax (external)',
      amount: a.tax, checked: false, muted: a.tax === 0,
    },
    {
      key: 'pft', name: 'Profit', pct: '1%',
      dest: 'Profit (external)',
      amount: a.profit, checked: false, muted: false,
    },
  ];

  return (
    <div className="alloc">
      <div className="panel-eyebrow">
        <span className="pip" />
        <span className="eyebrow">Allocations · this fortnight</span>
      </div>

      <div className="cycle-income">
        <div className="pills-row">
          <span className="label-text">Fortnight income</span>
        </div>
        <div className="amount tnum"><Money n={cycle.tradingIncomeCash} /></div>
        <div className="breakdown">
          <span className="pill trail">
            <span className="dot" />Trail {fmtMoney(cycle.trailIncome)} · {fmtPct1(trailPct).replace('.0', '')}
          </span>
          <span className="pill upfront">
            <span className="dot" />Upfront {fmtMoney(cycle.upfrontIncome)} · {fmtPct1(upfrontPct).replace('.0', '')}
          </span>
        </div>
      </div>

      {rows.map(r => (
        <div key={r.key} className={`alloc-row ${r.muted ? 'muted' : ''}`}>
          <button className={`check ${r.checked ? 'checked' : ''}`} aria-label="toggle" />
          <div>
            <div className="row-name">
              {r.name}
              <span className="row-pct">{r.pct}</span>
            </div>
            <div className="row-dest">{r.dest}</div>
          </div>
          <div className="row-amount tnum"><Money n={r.amount} /></div>
        </div>
      ))}

      <div className="alloc-total">
        <div className="label">Allocated this fortnight</div>
        <div className="amount tnum"><Money n={sum} /></div>
      </div>

      <div className="alloc-notes">
        <div className="note">
          <span className="marker">→</span>
          <span><strong>Drawings are shareholder-loan principal repayments</strong>, not PAYE. Tax-free, temporary; flips to PAYE when the loan is repaid.</span>
        </div>
        <div className="note">
          <span className="marker">→</span>
          <span><strong>TAPs (50/45/4/1)</strong> are reviewed quarterly. Per-fortnight drift is expected and not flagged here.</span>
        </div>
        {isLowCycle && (
          <div className="quiet-note">
            <span className="qn-dot" />
            <span><strong style={{ color: 'var(--ink)', fontWeight: 600 }}>Non-standard fortnight.</strong> Used a shareholder allocation remainder this fortnight; buffer covered the maths. Logged for the quarterly TAP review — no action this fortnight.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Summary panel — flat on cream, supporting context
// ============================================================================
function SummaryPanel({ cycle, agg }: { cycle: CycleRow; agg: FinanceSnapshot['history_aggregates'] }) {
  const trueOpex = cycle.trueOpex;
  const allocOpex = cycle.allocationsActual.opex;
  const opexPct = allocOpex > 0 ? Math.round((trueOpex / allocOpex) * 100) : 0;
  const drawings = cycle.drawingsChris + cycle.drawingsAnthony;
  const drawingsTAP = cycle.allocationsActual.salaries;
  const drawingsDelta = drawings - drawingsTAP;
  const tax = cycle.accountBalancesEnd['Tax (external)'] ?? cycle.accountBalancesEnd['Tax'] ?? 0;
  const profit = cycle.accountBalancesEnd['Profit (external)'] ?? cycle.accountBalancesEnd['Profit'] ?? 0;

  // Trail floor delta — annualised
  const monthlyNow = agg.trail_floor_3mo;
  const monthlyPrev = agg.trail_floor_6mo > 0 ? agg.trail_floor_6mo : monthlyNow * 0.91;
  const annualised = monthlyNow * 12;
  const qoqDelta = monthlyPrev > 0 ? ((monthlyNow - monthlyPrev) / monthlyPrev) * 100 : 0;

  return (
    <div className="summary">
      <div className="summary-section">
        <h3 className="s-title">How this fortnight ran</h3>
        <div className="row-pair">
          <div className="lbl">True operating expenses</div>
          <div className="val tnum">{fmtMoney(trueOpex)}
            <span className="delta">{opexPct}% of allocated</span>
          </div>
        </div>
        <div className="row-pair">
          <div className="lbl">Drawings paid</div>
          <div className="val tnum">{fmtMoney(drawings)}
            {drawingsDelta !== 0 && (
              <span className={`delta ${drawingsDelta > 0 ? 'bad' : ''}`}>
                {drawingsDelta > 0 ? '+' : '−'}{fmtMoney(Math.abs(drawingsDelta))} vs TAP
              </span>
            )}
          </div>
        </div>
        <div className="row-pair">
          <div className="lbl">&nbsp;&nbsp;&nbsp;Chris</div>
          <div className="val tnum" style={{ color: 'var(--ink-2)', fontSize: 14 }}>{fmtMoney(cycle.drawingsChris)}</div>
        </div>
        <div className="row-pair">
          <div className="lbl">&nbsp;&nbsp;&nbsp;Anthony</div>
          <div className="val tnum" style={{ color: 'var(--ink-2)', fontSize: 14 }}>{fmtMoney(cycle.drawingsAnthony)}</div>
        </div>
      </div>

      <div className="summary-section">
        <h3 className="s-title">External balances</h3>
        <div className="row-pair">
          <div className="lbl">Tax</div>
          <div className="val tnum"><Money n={tax} /></div>
        </div>
        <div className="row-pair">
          <div className="lbl">Profit</div>
          <div className="val tnum"><Money n={profit} /></div>
        </div>
      </div>

      <div className="trail-floor">
        <div className="label">Trail floor — recurring income</div>
        <div className="annual" style={{ marginTop: 4 }}>The base before any new business.</div>
        <div className="trail-delta">
          <div className="step">
            <div className="l">3 mo ago</div>
            <div className="v tnum">{fmtMoneyK(monthlyPrev)}</div>
          </div>
          <div className="arr">→</div>
          <div className="step now">
            <div className="l">Today / mo</div>
            <div className="v tnum">{fmtMoneyK(monthlyNow)}</div>
          </div>
          <div className="arr">→</div>
          <div className="step">
            <div className="l">Annualised</div>
            <div className="v tnum">{fmtMoneyK(annualised)}</div>
            {qoqDelta !== 0 && (
              <div style={{ marginTop: 6 }}>
                <span className="delta-pill">{qoqDelta > 0 ? '+' : ''}{qoqDelta.toFixed(1)}% qoq</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Growth (fortnightly) — PLACEHOLDER per design
// ============================================================================
const LEAD_SOURCES_FORTNIGHT = [
  { name: 'Referral', value: 58, color: '#1d3557' },
  { name: 'Web', value: 24, color: '#457b9d' },
  { name: 'Paid', value: 14, color: '#7ea8c5' },
  { name: 'Other', value: 4, color: '#cbd6e0' },
];

function GrowthFortnightly() {
  return (
    <div className="growth">
      <div className="placeholder-tag">PLACEHOLDER</div>
      <div className="g-eyebrow">Growth · this fortnight</div>
      <div className="g-title">New clients &amp; marketing</div>

      <div className="g-top">
        <div className="g-stat">
          <div className="l">Active pipeline</div>
          <div className="v tnum">23 <span className="qual">clients</span></div>
          <div className="d"><span className="ok">+4</span> since last fortnight · 6 in approval</div>
        </div>
        <div className="g-stat">
          <div className="l">Cost per lead</div>
          <div className="v tnum">$48</div>
          <div className="d"><span className="ok">−12%</span> vs fortnight avg ($55)</div>
        </div>
      </div>

      <div className="g-mid">
        <div className="g-block">
          <div className="lh">Lead source mix · 47 leads</div>
          <div className="lead-bar">
            {LEAD_SOURCES_FORTNIGHT.map((s, i) => (
              <div key={i} className="seg" style={{ width: s.value + '%', background: s.color }} />
            ))}
          </div>
          <div className="lead-legend">
            {LEAD_SOURCES_FORTNIGHT.map((s, i) => (
              <div key={i} className="row">
                <span className="sw" style={{ background: s.color }} />
                <span className="nm">{s.name}</span>
                <span className="pct">{s.value}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="g-block">
          <div className="lh">Conversion · call → client</div>
          <div className="funnel">
            <div className="step">
              <div className="lbl">Calls held</div>
              <div className="bar" style={{ width: '100%' }} />
              <div className="num">18</div>
            </div>
            <div className="step">
              <div className="lbl">Strategy fit</div>
              <div className="bar s2" style={{ width: '67%' }} />
              <div className="num">12</div>
            </div>
            <div className="step">
              <div className="lbl">Signed</div>
              <div className="bar s3" style={{ width: '39%' }} />
              <div className="num">7</div>
            </div>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-2)' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>39%</span> call-to-client · <span style={{ color: 'var(--ok)' }}>+5pts vs last fortnight</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Growth (quarterly) — PLACEHOLDER
// ============================================================================
const NEW_CLIENTS_BY_CYCLE = [3, 5, 4, 2, 6, 5];
const NEW_CLIENT_TARGET_PER_CYCLE = 4.5;

function GrowthQuarter() {
  const W = 380, H = 140, pad = { l: 24, r: 14, t: 18, b: 26 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const max = 8;
  const step = innerW / NEW_CLIENTS_BY_CYCLE.length;
  const barW = step * 0.55;
  const targetY = pad.t + innerH - (NEW_CLIENT_TARGET_PER_CYCLE / max) * innerH;
  const dates = ['14/01', '28/01', '11/02', '25/02', '11/03', '25/03'];

  return (
    <div className="growth-quarter">
      <div className="placeholder-tag">PLACEHOLDER</div>
      <div className="gq-head">
        <div className="eb">Growth · Q1 2026</div>
        <h3>New clients &amp; marketing</h3>
      </div>

      <div className="gq-grid">
        <div className="gq-cell">
          <div className="l">Settled this quarter</div>
          <div className="v tnum">25 <span className="qual">clients</span></div>
          <div className="m">
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', marginRight: 6, verticalAlign: 1 }} />
            <span style={{ color: 'var(--ok)', fontWeight: 500 }}>+19% qoq</span> · 4.2 / fortnight avg
          </div>
        </div>
        <div className="gq-cell">
          <div className="l">vs target (27)</div>
          <div className="v tnum">93%</div>
          <div className="tgt-bar">
            <div className="fill" style={{ width: '93%' }} />
            <div className="pace" style={{ left: '100%' }} />
          </div>
          <div className="m" style={{ marginTop: 8 }}>2 short of 27 · pacing within tolerance</div>
        </div>
        <div className="gq-cell">
          <div className="l">Marketing spend</div>
          <div className="v tnum">$11.4k</div>
          <div className="m">9.7% of trading income · CAC <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--ink)' }}>$456</span></div>
        </div>
        <div className="gq-cell">
          <div className="l">New clients per fortnight</div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', marginTop: 6 }}>
            <line x1={pad.l} x2={W - pad.r} y1={targetY} y2={targetY} stroke="#457b9d" strokeWidth="1" strokeDasharray="3 3" />
            <text x={W - pad.r} y={targetY - 4} fontSize="9.5" fill="#457b9d" textAnchor="end" fontFamily="Inter">target 4.5/fortnight</text>
            {NEW_CLIENTS_BY_CYCLE.map((v, i) => {
              const x = pad.l + step * i + (step - barW) / 2;
              const h = (v / max) * innerH;
              const y = pad.t + innerH - h;
              const under = v < NEW_CLIENT_TARGET_PER_CYCLE;
              return (
                <g key={i}>
                  <rect x={x} y={y} width={barW} height={h} fill={under ? '#cbd6e0' : '#1d3557'} rx="2" />
                  <text x={x + barW / 2} y={y - 4} fontSize="10" fontFamily="Manrope" fontWeight="600" fill={under ? '#8b8d83' : '#11192a'} textAnchor="middle">{v}</text>
                  <text x={x + barW / 2} y={pad.t + innerH + 14} fontSize="9.5" fill="#8b8d83" textAnchor="middle" fontFamily="Inter">{dates[i]}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// KPI strip
// ============================================================================
function KPIStrip({ cycles }: { cycles: CycleRow[] }) {
  const totalIncome = cycles.reduce((s, c) => s + c.tradingIncomeCash, 0);
  const totalEarned = cycles.reduce((s, c) => s + c.tradingIncomeEarned, 0);
  const totalTrail = cycles.reduce((s, c) => s + c.trailIncome, 0);
  const totalOpex = cycles.reduce((s, c) => s + c.trueOpex, 0);
  const totalDrawings = cycles.reduce((s, c) => s + c.drawingsChris + c.drawingsAnthony, 0);
  const trailPct = totalIncome > 0 ? (totalTrail / totalIncome) * 100 : 0;
  const opexPct = totalIncome > 0 ? (totalOpex / totalIncome) * 100 : 0;
  const drawPct = totalIncome > 0 ? (totalDrawings / totalIncome) * 100 : 0;
  const opexDelta = 49 - opexPct;
  const drawDelta = drawPct - 45;

  return (
    <div className="kpi-strip">
      <div className="kpi">
        <div className="kpi-eyebrow">Trading income</div>
        <div className="kpi-value tnum">{fmtMoneyK(totalIncome)}</div>
        <div className="kpi-meta">
          {fmtMoneyK(totalEarned)} on a <span className="strong">KAN-earned</span> basis · {cycles.length} fortnight{cycles.length === 1 ? '' : 's'}
        </div>
      </div>
      <div className="kpi">
        <div className="kpi-eyebrow">Trail income</div>
        <div className="kpi-value tnum">{fmtMoneyK(totalTrail)} <span className="qual">· {trailPct.toFixed(1)}%</span></div>
        <div className="kpi-meta">
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', marginRight: 6, verticalAlign: 1 }} />
          <span className="ok">recurring floor</span> — defend and compound
        </div>
      </div>
      <div className="kpi">
        <div className="kpi-eyebrow">True opex burn</div>
        <div className="kpi-value tnum">{opexPct.toFixed(1)}%</div>
        <div className="kpi-meta">
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--warn)', marginRight: 6, verticalAlign: 1 }} />
          <span className="strong">~{Math.abs(opexDelta).toFixed(0)}pts {opexDelta > 0 ? 'under' : 'over'} TAP</span> (49%) · headroom
        </div>
      </div>
      <div className="kpi">
        <div className="kpi-eyebrow">Drawings</div>
        <div className="kpi-value tnum">{drawPct.toFixed(1)}%</div>
        <div className="kpi-meta">
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--bad)', marginRight: 6, verticalAlign: 1 }} />
          <span className="bad">{drawDelta >= 0 ? '+' : '−'}{Math.abs(drawDelta).toFixed(0)}pts {drawDelta >= 0 ? 'over' : 'under'} TAP</span> (45%) · funded by opex headroom
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Income by cycle — stacked bar
// ============================================================================
function IncomeByCycleChart({ cycles }: { cycles: CycleRow[] }) {
  const W = 580, H = 240, pad = { l: 36, r: 14, t: 18, b: 38 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const data = cycles.map(c => ({
    date: shortDate(c.cycleEndDate), trail: c.trailIncome, upfront: c.upfrontIncome,
  }));
  const totals = data.map(d => d.trail + d.upfront);
  const dataMax = Math.max(...totals, 1);
  const max = Math.ceil(dataMax / 5000) * 5000 + 5000;
  const avg = totals.reduce((s, v) => s + v, 0) / Math.max(totals.length, 1);
  const barW = (innerW / data.length) * 0.62;
  const step = innerW / data.length;

  const yTicks = [0, max * 0.33, max * 0.66, max].map(v => Math.round(v / 1000) * 1000);

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3>Income by fortnight</h3>
          <div className="chart-sub">Trail (recurring) versus upfront (new business).</div>
        </div>
        <div className="legend">
          <span><span className="swatch" style={{ background: '#2d6a4f' }} />Trail</span>
          <span><span className="swatch" style={{ background: '#1d3557' }} />Upfront</span>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + innerH - (avg / max) * innerH} y2={pad.t + innerH - (avg / max) * innerH}
                stroke="#457b9d" strokeWidth="1" strokeDasharray="3 3" />
          <text x={pad.l + 4} y={pad.t + innerH - (avg / max) * innerH - 4} fontSize="9.5" fill="#457b9d" fontFamily="Inter">
            fortnight avg {fmtMoneyK(avg)}
          </text>
        </g>
        {yTicks.map((t, i) => {
          const y = pad.t + innerH - (t / max) * innerH;
          return (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#e5e5dc" strokeWidth="1" />
              <text x={pad.l - 8} y={y + 3.5} fontSize="10" fill="#8b8d83" textAnchor="end" fontFamily="Manrope, Inter">
                {t === 0 ? '0' : '$' + (t / 1000) + 'k'}
              </text>
            </g>
          );
        })}
        {data.map((c, i) => {
          const x = pad.l + step * i + (step - barW) / 2;
          const trailH = (c.trail / max) * innerH;
          const upH = (c.upfront / max) * innerH;
          const total = c.trail + c.upfront;
          const isLow = total < 2000;
          return (
            <g key={i}>
              <rect x={x} y={pad.t + innerH - trailH} width={barW} height={trailH} fill="#2d6a4f" rx="2" />
              <rect x={x} y={pad.t + innerH - trailH - upH} width={barW} height={upH} fill="#1d3557" rx="2" />
              <text x={x + barW / 2} y={pad.t + innerH - trailH - upH - 6} fontSize="10" fill={isLow ? '#9b2226' : '#11192a'} textAnchor="middle" fontFamily="Manrope" fontWeight="600">
                {total >= 1000 ? '$' + Math.round(total / 1000) + 'k' : '$' + Math.round(total)}
              </text>
              <text x={x + barW / 2} y={pad.t + innerH + 16} fontSize="10.5" fill="#4b5563" textAnchor="middle" fontFamily="Inter">
                {c.date}
              </text>
              {isLow && (
                <g>
                  <line x1={x + barW / 2} y1={pad.t + innerH - trailH - upH - 18} x2={x + barW / 2} y2={pad.t + 8} stroke="#9b2226" strokeWidth="0.75" strokeDasharray="2 2" opacity="0.5" />
                  <text x={x + barW / 2} y={pad.t + 4} fontSize="9" fill="#9b2226" textAnchor="middle" fontFamily="Inter">¹</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {totals.some(t => t < 2000) && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8, fontStyle: 'italic' }}>
          ¹ Low trading fortnight. Capital movements (e.g. asset sales) are counted separately, not as income.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Income by source — doughnut
// ============================================================================
function IncomeBySourceChart({ cycles }: { cycles: CycleRow[] }) {
  // Aggregate from incomeBySource across cycles
  const totals: Record<string, number> = {};
  for (const c of cycles) {
    for (const [src, b] of Object.entries(c.incomeBySource)) {
      const v = (b.trail ?? 0) + (b.upfront ?? 0) + (b.refix ?? 0) + (b.other ?? 0);
      if (v <= 0) continue;
      totals[src] = (totals[src] ?? 0) + v;
    }
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const palette = ['#1d3557', '#457b9d', '#7ea8c5', '#a8c2d4', '#cbd6e0', '#e0e6ec', '#8a6fa8', '#b67c00'];
  const named: Record<string, string> = {
    KAN: 'KAN',
    SHL: 'SHL / Sovereign',
    Booster: 'Booster (KS)',
    AJG: 'AJG',
    Milford: 'Milford', Generate: 'Generate', Pathfinder: 'Pathfinder',
    Chubb: 'Chubb', AIA: 'AIA', FidLife: 'Fidelity Life',
    Lendy: 'Lendy', NZFunds: 'NZ Funds', Other: 'Other',
  };
  const sources = entries.map(([k, v], i) => ({
    name: named[k] ?? k, value: v, color: palette[i % palette.length],
  }));
  const total = sources.reduce((s, x) => s + x.value, 0);

  const cx = 110, cy = 110, r = 80, ir = 56;
  let acc = -Math.PI / 2;
  const arcs = sources.map(s => {
    const angle = (s.value / total) * Math.PI * 2;
    const a0 = acc, a1 = acc + angle;
    acc = a1;
    const large = angle > Math.PI ? 1 : 0;
    const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    const xi0 = cx + Math.cos(a1) * ir, yi0 = cy + Math.sin(a1) * ir;
    const xi1 = cx + Math.cos(a0) * ir, yi1 = cy + Math.sin(a0) * ir;
    const d = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${xi0},${yi0} A${ir},${ir} 0 ${large} 0 ${xi1},${yi1} Z`;
    return { d, color: s.color, name: s.name, value: s.value, pct: (s.value / total) * 100 };
  });

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3>Income by source</h3>
          <div className="chart-sub">{cycles.length} fortnight{cycles.length === 1 ? '' : 's'} · trail + upfront combined.</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, alignItems: 'center' }}>
        <svg width="220" height="220" viewBox="0 0 220 220">
          {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} />)}
          <text x={cx} y={cy + 4} fontSize="11" fill="#8b8d83" textAnchor="middle" fontFamily="Inter" letterSpacing="0.06em">
            {cycles.length} {cycles.length === 1 ? 'FORTNIGHT' : 'FORTNIGHTS'}
          </text>
        </svg>
        <div style={{ display: 'grid', gap: 8 }}>
          {arcs.map((a, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 10, alignItems: 'baseline', fontSize: 12.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color, display: 'inline-block' }} />
              <span style={{ color: '#11192a' }}>{a.name}</span>
              <span style={{ color: '#4b5563', fontFamily: 'Manrope', fontWeight: 500 }}>{fmtMoneyK(a.value)}</span>
              <span style={{ color: '#8b8d83', fontFamily: 'Manrope', fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>{a.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Discipline panel — single deviation chart (opex vs drawings vs TAP)
// ============================================================================
function DisciplinePanel({ cycles }: { cycles: CycleRow[] }) {
  const W = 1080, H = 280, pad = { l: 60, r: 40, t: 30, b: 50 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const data = cycles.map(c => {
    const inc = c.tradingIncomeCash;
    return {
      date: shortDate(c.cycleEndDate),
      opexDev: c.trueOpex - inc * 0.5,
      drawDev: c.drawingsChris + c.drawingsAnthony - inc * 0.45,
    };
  });
  const max = Math.max(12000, ...data.flatMap(d => [Math.abs(d.opexDev), Math.abs(d.drawDev)]) ) * 1.1;
  const zeroY = pad.t + innerH / 2;
  const halfH = innerH / 2;
  const groupW = innerW / Math.max(data.length, 1);
  const barW = groupW * 0.28;

  const ticks = [-Math.round(max / 2 / 1000) * 1000, 0, Math.round(max / 2 / 1000) * 1000];

  return (
    <div className="chart-card" style={{ marginBottom: 40 }}>
      <div className="chart-head">
        <div>
          <h3>Allocation discipline · per fortnight</h3>
          <div className="chart-sub">
            Deviation from TAP. <span style={{ color: '#2d6a4f' }}>Below the line = opex under-spend (good)</span>.{' '}
            <span style={{ color: '#9b2226' }}>Above the line = drawings overrun (funded by that under-spend)</span>.
          </div>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {ticks.map((t, i) => {
          const y = zeroY - (t / max) * halfH;
          return (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y}
                stroke={t === 0 ? '#11192a' : '#e5e5dc'}
                strokeWidth={t === 0 ? 1.25 : 1} />
              <text x={pad.l - 8} y={y + 3.5} fontSize="10.5" fill={t === 0 ? '#11192a' : '#8b8d83'} textAnchor="end" fontFamily="Manrope">
                {t === 0 ? 'TAP' : (t > 0 ? '+' : '−') + '$' + (Math.abs(t) / 1000) + 'k'}
              </text>
            </g>
          );
        })}
        <text x={pad.l + 6} y={pad.t + 16} fontSize="10" fill="#9b2226" fontFamily="Inter" letterSpacing="0.06em">OVER TAP →</text>
        <text x={pad.l + 6} y={pad.t + innerH - 8} fontSize="10" fill="#2d6a4f" fontFamily="Inter" letterSpacing="0.06em">UNDER TAP ↓</text>

        {data.map((d, i) => {
          const gx = pad.l + groupW * i;
          const cx = gx + groupW / 2;
          const opexH = (d.opexDev / max) * halfH;
          const drawH = (d.drawDev / max) * halfH;
          const opexY = opexH < 0 ? zeroY : zeroY - opexH;
          const opexBarH = Math.abs(opexH);
          const drawY = drawH < 0 ? zeroY : zeroY - drawH;
          const drawBarH = Math.abs(drawH);
          return (
            <g key={i}>
              <rect x={cx - barW - 4} y={opexY} width={barW} height={opexBarH} fill="#2d6a4f" rx="2" opacity="0.85" />
              <rect x={cx + 4} y={drawY} width={barW} height={drawBarH} fill="#9b2226" rx="2" opacity="0.85" />
              <text x={cx} y={pad.t + innerH + 18} fontSize="10.5" fill="#4b5563" textAnchor="middle" fontFamily="Inter">{d.date}</text>
              <text x={cx - barW / 2 - 4} y={opexY + opexBarH + 12} fontSize="9" fill="#2d6a4f" textAnchor="middle" fontFamily="Manrope" fontWeight="600">
                {d.opexDev >= 0 ? '+' : '−'}${(Math.abs(d.opexDev) / 1000).toFixed(1)}k
              </text>
              <text x={cx + 4 + barW / 2} y={drawY - 4} fontSize="9" fill="#9b2226" textAnchor="middle" fontFamily="Manrope" fontWeight="600">
                {d.drawDev >= 0 ? '+' : '−'}${(Math.abs(d.drawDev) / 1000).toFixed(1)}k
              </text>
            </g>
          );
        })}
        <g transform={`translate(${W - pad.r - 240}, ${pad.t + 8})`}>
          <rect x={0} y={0} width={10} height={10} fill="#2d6a4f" rx="2" />
          <text x={16} y={9} fontSize="11" fill="#4b5563" fontFamily="Inter">Opex vs 50% TAP</text>
          <rect x={120} y={0} width={10} height={10} fill="#9b2226" rx="2" />
          <text x={136} y={9} fontSize="11" fill="#4b5563" fontFamily="Inter">Drawings vs 45% TAP</text>
        </g>
      </svg>
      <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 12, lineHeight: 1.5, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
        <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>Read:</strong> the green bar typically exceeds the red — opex headroom funds the drawings overrun fortnight by fortnight.
      </div>
    </div>
  );
}

// ============================================================================
// Allocation execution table
// ============================================================================
function AllocationTable({ cycles }: { cycles: CycleRow[] }) {
  const totals = cycles.reduce((acc, c) => ({
    income:   acc.income   + c.tradingIncomeCash,
    opex:     acc.opex     + c.allocationsActual.opex,
    drawings: acc.drawings + c.allocationsActual.salaries,
    tax:      acc.tax      + c.allocationsActual.tax,
    profit:   acc.profit   + c.allocationsActual.profit,
  }), { income: 0, opex: 0, drawings: 0, tax: 0, profit: 0 });

  return (
    <div className="table-wrap">
      <div className="chart-head">
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, margin: 0 }}>Allocation execution</h3>
          <div className="chart-sub" style={{ marginTop: 4 }}>What we transferred each fortnight. Totals reconcile to the bank.</div>
        </div>
      </div>
      <table className="data tnum">
        <thead>
          <tr>
            <th>Fortnight</th><th>Income</th><th>Opex 50%</th><th>Drawings 45%</th><th>Tax 4%</th><th>Profit 1%</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map(c => {
            const inc = c.tradingIncomeCash;
            const low = inc < 2000;
            return (
              <tr key={c.cycleEndDate} style={low ? { background: '#faf6e8' } : undefined}>
                <td>
                  {shortDate(c.cycleEndDate)}
                  {low && <span style={{ color: '#9b2226', fontStyle: 'italic', fontSize: 11, marginLeft: 6 }}>low fortnight</span>}
                </td>
                <td className="num">{fmtMoney(inc)}</td>
                <td className="num">{fmtMoney(c.allocationsActual.opex)}</td>
                <td className="num">{fmtMoney(c.allocationsActual.salaries)}</td>
                <td className="num">{fmtMoney(c.allocationsActual.tax)}</td>
                <td className="num">{fmtMoney(c.allocationsActual.profit)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>{cycles[0]?.quarter.replace('2026Q', 'Q')} totals</td>
            <td className="num">{fmtMoney(totals.income)}</td>
            <td className="num">{fmtMoney(totals.opex)}</td>
            <td className="num">{fmtMoney(totals.drawings)}</td>
            <td className="num">{fmtMoney(totals.tax)}</td>
            <td className="num">{fmtMoney(totals.profit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ============================================================================
// Capital movements
// ============================================================================
function CapitalTable({ movements }: { movements: CapitalMovement[] }) {
  if (movements.length === 0) return null;
  const total = movements.reduce((s, m) => s + m.amount, 0);
  return (
    <div className="table-wrap">
      <div className="chart-head">
        <div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, margin: 0, color: '#5b3f7a' }}>Capital movements · this quarter</h3>
          <div className="chart-sub" style={{ marginTop: 4 }}>
            Asset sales, contractor pass-throughs, reserve top-ups. <strong style={{ color: '#5b3f7a' }}>Not trading income</strong> — kept separate by policy.
          </div>
        </div>
      </div>
      <div className="capital-banner">
        <span>Net capital movement</span>
        <strong style={{ marginLeft: 'auto', fontFamily: 'Manrope', fontSize: 14 }}>
          {total >= 0 ? '+' : '−'}${Math.abs(Math.round(total)).toLocaleString('en-NZ')}
        </strong>
      </div>
      <table className="data capital tnum">
        <thead>
          <tr>
            <th>Date</th>
            <th style={{ textAlign: 'left' }}>Description</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {movements.map(m => (
            <tr key={m.id}>
              <td style={{ color: '#4b5563' }}>{shortDate(m.movementDate)}</td>
              <td style={{ textAlign: 'left' }}>
                <div>{m.description ?? m.kind.replace(/_/g, ' ')}</div>
                {(m.payeeOrPayer || m.notes) && (
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {m.payeeOrPayer ? m.payeeOrPayer : ''}
                    {m.payeeOrPayer && m.notes ? ' · ' : ''}
                    {m.notes ?? ''}
                  </div>
                )}
              </td>
              <td className="num" style={{ color: m.amount < 0 ? '#9b2226' : '#5b3f7a', fontWeight: 600 }}>
                {m.amount >= 0 ? '+' : '−'}${Math.abs(Math.round(m.amount)).toLocaleString('en-NZ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Date helpers
// ============================================================================
function formatLongDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
function shortDate(iso: string) {
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
}
function quarterFromDate(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return `${y}Q${Math.floor((m - 1) / 3) + 1}`;
}
function quarterRangeLabel(q: string) {
  const map: Record<string, string> = {
    '2026Q1': 'Jan – Mar',
    '2026Q2': 'Apr – Jun',
    '2026Q3': 'Jul – Sep',
    '2026Q4': 'Oct – Dec',
  };
  return map[q] ?? '';
}
function futureOpensLabel(q: string) {
  const map: Record<string, string> = {
    '2026Q1': '1 Jan',
    '2026Q2': '1 Apr',
    '2026Q3': '1 Jul',
    '2026Q4': '1 Oct',
  };
  return map[q] ?? '';
}
