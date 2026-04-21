'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { BankData, BankId, CardedData, TurnaroundEntry, TurnaroundMap } from '@/app/lib/types';

type Bank = {
  id: BankId;
  name: string;
  data: BankData;
  updatedAt: string;
  cardedData?: CardedData | null;
  cardedUpdatedAt?: string | null;
};
type CustomerType = 'existing' | 'new';
type RateMode = 'fixed' | 'floating';

// Discrepancy threshold: ≥5 basis points (0.05%) between broker and carded.
const DISCREPANCY_BPS = 5;

/** Returns the carded rate for a given term key, or null if the scraper didn't capture it. */
function cardedRateFor(bank: Bank, termKey: string, kind: 'lte80' | 'gt80'): number | null {
  if (termKey === 'floating') return bank.cardedData?.rateCard.floating ?? null;
  const v = bank.cardedData?.rateCard[kind]?.[termKey];
  return typeof v === 'number' ? v : null;
}

/** Returns the broker rate as a number if it's numeric, else null. */
function brokerRateFor(bank: Bank, termKey: string, kind: 'lte80' | 'gt80'): number | null {
  const r = bank.data.rateCard?.[termKey];
  const v = kind === 'lte80' ? r?.lte80 : r?.gt80;
  return typeof v === 'number' ? v : null;
}

type CellComparison = {
  broker: number | null;
  carded: number | null;
  deltaBps: number | null;   // |broker - carded| in basis points, null if either missing
  discrepant: boolean;       // delta >= DISCREPANCY_BPS
};

function compareCell(broker: number | null, carded: number | null): CellComparison {
  if (broker === null || carded === null) {
    return { broker, carded, deltaBps: null, discrepant: false };
  }
  const bps = Math.round(Math.abs(broker - carded) * 100);
  return { broker, carded, deltaBps: bps, discrepant: bps >= DISCREPANCY_BPS };
}

const BANK_ORDER: BankId[] = ['westpac', 'asb', 'bnz', 'anz', 'kiwibank'];

const BANK_ACCENT: Record<BankId, string> = {
  westpac: '#ba1a1a',   // red
  asb:     '#eab308',   // yellow
  bnz:     '#031f41',   // navy
  anz:     '#2b6485',   // secondary
  kiwibank:'#22c55e',   // green
};

const TERM_ORDER: Array<{ key: string; label: string }> = [
  { key: '6mo',  label: '6 Months' },
  { key: '1y',   label: '1 Year' },
  { key: '18mo', label: '18 Months' },
  { key: '2y',   label: '2 Years' },
  { key: '3y',   label: '3 Years' },
  { key: '4y',   label: '4 Years' },
  { key: '5y',   label: '5 Years' },
];

function fmtRate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toFixed(2) + '%';
  return String(v);
}
function fmtPct(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return (v * 100).toFixed(2) + '%';
  return String(v);
}
function fmtDate(s?: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Short "21 Apr" format used for the TAT updated-at stamp. */
function fmtShortDate(s?: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-NZ', { day: 'numeric', month: 'short' });
}

/** True when the stamp is ≥14 days old — used to amber-flag stale TAT values. */
function isStale(iso: string | undefined, thresholdDays = 14): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > thresholdDays * 24 * 60 * 60 * 1000;
}

/**
 * Picks the retail entries out of a TurnaroundMap.
 * Match rule: key matches /retail/i (case-insensitive). If nothing matches,
 * falls back to an empty list (the UI shows "—"). Keeps the original keys so
 * the caller can distinguish e.g. "Priority Retail" from "Other Retail".
 */
function pickRetailEntries(tmap: TurnaroundMap | undefined): Array<{ key: string; entry: TurnaroundEntry }> {
  if (!tmap) return [];
  const out: Array<{ key: string; entry: TurnaroundEntry }> = [];
  for (const [key, entry] of Object.entries(tmap)) {
    if (/retail/i.test(key)) out.push({ key, entry });
  }
  return out;
}

/** Returns the most recent updatedAt across a set of entries. */
function mostRecentUpdatedAt(entries: Array<{ entry: TurnaroundEntry }>): string | undefined {
  if (entries.length === 0) return undefined;
  let latest: string | undefined;
  for (const { entry } of entries) {
    if (!latest || new Date(entry.updatedAt).getTime() > new Date(latest).getTime()) {
      latest = entry.updatedAt;
    }
  }
  return latest;
}

/** Maps a traffic-light value string to (label, badge colour). */
function statusFor(trafficLight?: string): { label: string; tone: 'active' | 'warn' | 'critical' } {
  if (!trafficLight) return { label: 'Unknown', tone: 'warn' };
  const s = trafficLight.toLowerCase();
  if (s.includes('pre-approval & live') || s.includes('preapproval & live')) return { label: 'Active', tone: 'active' };
  if (s.includes('live only')) return { label: 'Live Only', tone: 'warn' };
  if (s === 'no' || s.startsWith('no ')) return { label: 'Closed', tone: 'critical' };
  return { label: trafficLight, tone: 'warn' };
}

export default function LendersPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState('');
  const [customer, setCustomer] = useState<CustomerType>('new');
  const [rateMode, setRateMode] = useState<RateMode>('fixed');

  // TAT-detail modal state: which bank we're inspecting (if any), and a
  // session-scoped flag remembering whether the TAT PIN has been unlocked.
  const [tatDetailBankId, setTatDetailBankId] = useState<BankId | null>(null);
  const [tatPinUnlocked, setTatPinUnlocked] = useState(false);

  /** Patch a single bank's turnaround map in local state after an override save. */
  const applyTurnaroundUpdate = useCallback((bankId: BankId, turnaround: TurnaroundMap) => {
    setBanks(prev => prev.map(b => (
      b.id === bankId ? { ...b, data: { ...b.data, turnaround } } : b
    )));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bank-rates');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const sorted = [...data.banks].sort(
        (a: Bank, b: Bank) => BANK_ORDER.indexOf(a.id) - BANK_ORDER.indexOf(b.id),
      );
      setBanks(sorted);
      setFetchedAt(data.fetchedAt);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const lastRefresh = useMemo(() => fetchedAt ? fmtDate(fetchedAt) : '—', [fetchedAt]);

  /**
   * Rolls up broker-vs-carded cell comparisons across every bank × term × LVR tier.
   * Only the term keys we display (6mo, 1y, 2y, 3y, 4y, 5y) + floating are considered.
   * Cells where either side is missing count toward `missing`, not `agree`/`disagree`.
   */
  const accuracy = useMemo(() => {
    const terms = ['6mo', '1y', '2y', '3y', '4y', '5y', 'floating'];
    let agree = 0;        // both present, |Δ| < 5 bps
    let brokerBetter = 0; // carded > broker (broker has a special)
    let cardedBetter = 0; // broker > carded (anomaly worth investigating)
    let missing = 0;      // one side null
    let compared = 0;     // both present (agree + brokerBetter + cardedBetter)
    for (const b of banks) {
      for (const term of terms) {
        const tiers: Array<'lte80' | 'gt80'> = term === 'floating' ? ['gt80'] : ['lte80', 'gt80'];
        for (const tier of tiers) {
          const cmp = compareCell(brokerRateFor(b, term, tier), cardedRateFor(b, term, tier));
          if (cmp.broker === null || cmp.carded === null) { missing++; continue; }
          compared++;
          if (!cmp.discrepant) agree++;
          else if (cmp.carded! > cmp.broker!) brokerBetter++;
          else cardedBetter++;
        }
      }
    }
    const total = compared + missing;
    const agreePct = compared > 0 ? Math.round((agree / compared) * 100) : 0;
    return { total, compared, agree, brokerBetter, cardedBetter, missing, agreePct };
  }, [banks]);

  const cardedLastScrape = useMemo(() => {
    const stamps = banks.map(b => b.cardedData?.scrapedAt).filter(Boolean) as string[];
    if (stamps.length === 0) return null;
    stamps.sort();
    return stamps[stamps.length - 1];
  }, [banks]);

  if (loading && banks.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f7f9fe' }}>
        <div className="text-center">
          <div className="w-10 h-10 border-[3px] border-[#e5e8ed] border-t-[#031f41] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-[#44474e]">Loading lender matrix...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f7f9fe', fontFamily: 'Inter, sans-serif' }}>
      {/* TOP NAV */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex justify-between items-center w-full px-8 h-16">
        <div className="flex items-center gap-8">
          <div className="text-lg font-black text-[#031f41] uppercase tracking-widest" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Tanta Intelligence
          </div>
          <div className="hidden md:flex items-center bg-[#f1f4f9] px-4 py-2 rounded-xl">
            <span className="material-symbols-outlined text-[#74777f] text-sm mr-2">search</span>
            <input
              className="bg-transparent border-none focus:ring-0 text-sm w-64 placeholder-[#74777f]"
              placeholder="Search lenders..."
              type="text"
            />
          </div>
        </div>
        <nav className="flex items-center gap-4">
          <button className="material-symbols-outlined text-slate-500 hover:bg-slate-50 p-2 rounded-xl cursor-pointer">notifications</button>
          <button className="material-symbols-outlined text-slate-500 hover:bg-slate-50 p-2 rounded-xl cursor-pointer">settings</button>
          <div className="w-8 h-8 rounded-xl bg-[#1d3557] flex items-center justify-center text-white text-xs font-bold">CB</div>
        </nav>
      </header>

      {/* SIDE NAV */}
      <aside className="h-full w-64 fixed left-0 top-0 pt-16 bg-[#e5e8ed] flex flex-col gap-2 p-6 z-40">
        <div className="mb-6 px-2">
          <h2 className="font-extrabold text-[#031f41] text-xl" style={{ fontFamily: 'Manrope, sans-serif' }}>Lenders</h2>
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest mt-1">Bank Intelligence Suite</p>
        </div>
        <nav className="space-y-1">
          <NavLink icon="account_tree" label="Pipeline" href="/" />
          <NavLink icon="description" label="Applications" />
          <NavLink icon="folder_shared" label="Client Vault" />
          <NavLink icon="compare_arrows" label="Bank Comparisons" href="/lenders" active />
          <NavLink icon="trending_up" label="Market Rates" />
          <NavLink icon="analytics" label="Historical Trends" />
          <NavLink icon="public" label="Economic Outlook" />
          <NavLink icon="assignment" label="Executive Summary" />
        </nav>
      </aside>

      {/* MAIN */}
      <main className="pl-64 pt-16 min-h-screen">
        <div className="p-8 max-w-[1600px] mx-auto">

          {/* PAGE HEADER */}
          <div className="mb-8 flex justify-between items-end flex-wrap gap-4">
            <div>
              <span className="text-[#44474e] text-[10px] font-bold uppercase tracking-[0.2em] mb-2 block">Competitive Analysis</span>
              <h1 className="text-4xl font-extrabold text-[#031f41] tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Comparative Banking Sector Matrix
              </h1>
              <p className="text-xs text-[#44474e] mt-2">Live data · last refreshed {lastRefresh}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => window.print()}
                className="bg-[#dfe3e8] px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#c4c6cf] transition-colors text-[#031f41]"
              >
                <span className="material-symbols-outlined text-lg">download</span>
                Export PDF
              </button>
              <button
                onClick={fetchData}
                disabled={loading}
                className="bg-[#031f41] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                <span className={`material-symbols-outlined text-lg ${loading ? 'animate-spin' : ''}`}>refresh</span>
                {loading ? 'Updating...' : 'Update Feed'}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-[#ffdad6] text-[#93000a] rounded-xl text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* BENTO GRID — BANK CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-12">
            {banks.map(b => {
              const tl = b.data.trafficLights?.['80_90']?.[customer];
              const st = statusFor(tl);
              const lep85 = typeof b.data.lep?.['80_85'] === 'number'
                ? fmtPct(b.data.lep['80_85']) : (b.data.lep?.['80_85'] ?? '—');
              const lep90 = typeof b.data.lep?.['85_90'] === 'number'
                ? fmtPct(b.data.lep['85_90']) : (b.data.lep?.['85_90'] ?? '—');

              return (
                <div
                  key={b.id}
                  className="bg-white p-6 rounded-xl shadow-sm border-l-4"
                  style={{ borderLeftColor: BANK_ACCENT[b.id] }}
                >
                  <div className="flex justify-between items-start mb-6">
                    <h3 className="font-bold text-xl text-[#031f41]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                      {b.name}
                    </h3>
                    <StatusBadge tone={st.tone} label={st.label} />
                  </div>
                  <div className="space-y-4">
                    <Row label="LEP 80-85 / 85-90">
                      <span className="text-sm font-bold text-[#031f41]">{lep85} / {lep90}</span>
                    </Row>
                    <Row label="Service Rate">
                      <span className="text-sm font-bold text-[#031f41]">{fmtRate(b.data.serviceRate)}</span>
                    </Row>
                    <TurnaroundRow bank={b} onOpen={() => setTatDetailBankId(b.id)} />

                  </div>
                  <div className="mt-6 flex gap-2">
                    <button
                      onClick={() => setCustomer('existing')}
                      className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors ${
                        customer === 'existing'
                          ? 'bg-[#031f41] text-white hover:opacity-90'
                          : 'border border-[#c4c6cf]/50 text-[#44474e] hover:bg-[#f1f4f9]'
                      }`}
                    >
                      Existing
                    </button>
                    <button
                      onClick={() => setCustomer('new')}
                      className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors ${
                        customer === 'new'
                          ? 'bg-[#031f41] text-white hover:opacity-90'
                          : 'border border-[#c4c6cf]/50 text-[#44474e] hover:bg-[#f1f4f9]'
                      }`}
                    >
                      New
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* PAYMENT FREQUENCIES + MARKET INSIGHTS + SOURCE ACCURACY */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-12">
            {/* Frequencies */}
            <div className="lg:col-span-2">
              <h2 className="text-lg font-bold text-[#031f41] mb-4 flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                <span className="material-symbols-outlined text-[#2b6485]">calendar_month</span>
                Payment Frequencies Available
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {(['Weekly', 'Fortnightly', 'Monthly'] as const).map(freq => {
                  const banksAtFreq = banks.filter(b => {
                    const v = (b.data.productFeatures?.minRepaymentFreq ?? '').toLowerCase();
                    // Weekly covers everyone who allows weekly; fortnightly covers weekly+fortnightly; monthly covers all.
                    if (freq === 'Weekly') return v.includes('weekly');
                    if (freq === 'Fortnightly') return v.includes('weekly') || v.includes('fortnightly');
                    return true; // monthly
                  });
                  return (
                    <div key={freq} className="bg-white border border-[#dfe3e8] p-4 rounded-xl flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#44474e] mb-1">{freq}</span>
                      <div className="text-[#031f41] font-bold text-sm">
                        {banksAtFreq.length === banks.length ? 'All Banks' : `${banksAtFreq.length} of ${banks.length}`}
                      </div>
                      <div className="text-[10px] text-[#74777f] mt-1">
                        {banksAtFreq.map(b => b.name).join(' · ') || 'None'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Market insights */}
            <div className="bg-[#1d3557] text-white p-6 rounded-xl relative overflow-hidden">
              <div className="relative z-10">
                <h2 className="text-lg font-bold mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>Market Insights</h2>
                <p className="text-sm text-[#879ec6] mb-4">
                  Rate card for {customer === 'new' ? 'new-to-bank' : 'existing'} customers · viewing{' '}
                  {rateMode === 'fixed' ? 'fixed-term' : 'floating'} rates.
                  Flip the Existing/New buttons to compare appetite.
                </p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <Stat label="Banks tracked" value={String(banks.length)} />
                  <Stat label="Last feed" value={lastRefresh} />
                </div>
                <div className="flex items-center gap-2 text-xs font-bold text-[#a3d8fe]">
                  <span>Daily cron · 07:00 NZST</span>
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </div>
              </div>
              <div className="absolute -right-4 -bottom-4 opacity-10 pointer-events-none">
                <span className="material-symbols-outlined text-9xl">trending_up</span>
              </div>
            </div>

            {/* Source accuracy: broker emails vs interest.co.nz carded rates */}
            <div className="bg-white border border-[#dfe3e8] p-6 rounded-xl">
              <h2 className="text-lg font-bold text-[#031f41] mb-2 flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                <span className="material-symbols-outlined text-[#2b6485]">fact_check</span>
                Source Accuracy
              </h2>
              <p className="text-xs text-[#44474e] mb-4">
                Broker-email rates vs carded (interest.co.nz). Agreement = within {DISCREPANCY_BPS} bps.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-[#74777f] font-bold">Agreement</p>
                  <p className="text-2xl font-extrabold text-[#031f41] leading-tight">{accuracy.agreePct}%</p>
                  <p className="text-[10px] text-[#44474e]">{accuracy.agree} of {accuracy.compared} cells</p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-[#74777f] font-bold">Total cells</p>
                  <p className="text-2xl font-extrabold text-[#031f41] leading-tight">{accuracy.total}</p>
                  <p className="text-[10px] text-[#44474e]">{accuracy.missing} missing one source</p>
                </div>
              </div>
              <div className="space-y-1 text-[11px] border-t border-[#e5e8ed] pt-3">
                <div className="flex justify-between">
                  <span className="text-[#44474e]">Broker better (has special)</span>
                  <span className="font-bold text-[#031f41]">{accuracy.brokerBetter}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#44474e]">Carded better (investigate)</span>
                  <span className="font-bold text-[#93000a]">{accuracy.cardedBetter}</span>
                </div>
                <div className="flex justify-between text-[10px] text-[#74777f] pt-1">
                  <span>Carded last scraped</span>
                  <span>{cardedLastScrape ? fmtDate(cardedLastScrape) : '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* COMPREHENSIVE RATE CARD */}
          <section className="mt-4">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
              <div>
                <span className="text-[#44474e] text-[10px] font-black uppercase tracking-[0.3em] mb-1 block">Live Term Comparison</span>
                <h2 className="text-2xl font-bold text-[#031f41]" style={{ fontFamily: 'Manrope, sans-serif' }}>Comprehensive Rate Card</h2>
              </div>
              <div className="bg-[#f1f4f9] p-1 rounded-xl flex gap-1">
                <button
                  onClick={() => setRateMode('fixed')}
                  className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                    rateMode === 'fixed' ? 'bg-white shadow-sm text-[#031f41]' : 'text-[#44474e] hover:text-[#031f41]'
                  }`}
                >
                  Fixed Term
                </button>
                <button
                  onClick={() => setRateMode('floating')}
                  className={`px-3 py-1 text-xs font-bold rounded transition-all ${
                    rateMode === 'floating' ? 'bg-white shadow-sm text-[#031f41]' : 'text-[#44474e] hover:text-[#031f41]'
                  }`}
                >
                  Floating
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#e5e8ed]">
                      <th className="px-8 py-5 text-[10px] font-black text-[#44474e] uppercase tracking-widest">Term Duration</th>
                      {banks.map(b => (
                        <th key={b.id} className="px-8 py-5 text-[10px] font-black text-[#44474e] uppercase tracking-widest text-center border-l border-[#c4c6cf]/20">
                          {b.name} <span className="text-[#74777f] font-medium normal-case">(Spec / Std)</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5e8ed]">
                    {(rateMode === 'fixed' ? TERM_ORDER : [{ key: 'floating', label: 'Floating' }]).map((term, i) => (
                      <tr key={term.key} className={`transition-colors hover:bg-[#031f41]/5 ${i % 2 === 1 ? 'bg-[#031f41]/[0.02]' : ''}`}>
                        <td className="px-8 py-4 font-bold text-[#031f41]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                          {term.label}
                        </td>
                        {banks.map(b => {
                          const r = b.data.rateCard?.[term.key];
                          const lteCmp = compareCell(brokerRateFor(b, term.key, 'lte80'), cardedRateFor(b, term.key, 'lte80'));
                          const gtCmp = compareCell(brokerRateFor(b, term.key, 'gt80'), cardedRateFor(b, term.key, 'gt80'));

                          // 5-year fallback: when the broker doesn't publish a
                          // 5y rate (common — long rates are rarely in broker
                          // update emails), show the carded rate as the primary
                          // number with a muted "(carded)" label. Suppress the
                          // discrepancy flag for the fallen-back tier because
                          // broker-vs-carded would trivially "agree" (there's
                          // no broker side).
                          const lteFallback = term.key === '5y' && lteCmp.broker === null && lteCmp.carded !== null;
                          const gtFallback  = term.key === '5y' && gtCmp.broker  === null && gtCmp.carded  !== null;
                          const lteDisplay = lteFallback ? lteCmp.carded : r?.lte80;
                          const gtDisplay  = gtFallback  ? gtCmp.carded  : r?.gt80;
                          const anyDiscrepancy =
                            (lteCmp.discrepant && !lteFallback) || (gtCmp.discrepant && !gtFallback);
                          const maxDelta = Math.max(
                            (lteFallback ? 0 : (lteCmp.deltaBps ?? 0)),
                            (gtFallback  ? 0 : (gtCmp.deltaBps  ?? 0)),
                          );
                          const title = [
                            `lte80: broker=${fmtRate(lteCmp.broker)} carded=${fmtRate(lteCmp.carded)}${lteCmp.deltaBps !== null ? ` Δ${lteCmp.deltaBps}bps` : ''}${lteFallback ? ' (fallback to carded)' : ''}`,
                            `gt80: broker=${fmtRate(gtCmp.broker)} carded=${fmtRate(gtCmp.carded)}${gtCmp.deltaBps !== null ? ` Δ${gtCmp.deltaBps}bps` : ''}${gtFallback ? ' (fallback to carded)' : ''}`,
                          ].join('\n');
                          return (
                            <td key={`${b.id}-${term.key}`} className="px-8 py-4 text-center border-l border-[#c4c6cf]/5 relative" title={title}>
                              {anyDiscrepancy && (
                                <span
                                  className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#f59e0b]"
                                  title={`Broker vs carded differs by ${maxDelta}bps`}
                                />
                              )}
                              <div className="flex items-baseline justify-center gap-2">
                                <span className="text-sm font-extrabold text-[#031f41]">{fmtRate(lteDisplay)}</span>
                                {lteFallback && <span className="text-[8px] text-[#a1a5ab] uppercase tracking-wider">(carded)</span>}
                                <span className="text-[10px] text-[#44474e] font-medium">/ {fmtRate(gtDisplay)}</span>
                                {gtFallback && <span className="text-[8px] text-[#a1a5ab] uppercase tracking-wider">(carded)</span>}
                              </div>
                              <div className="flex items-baseline justify-center gap-2 mt-0.5">
                                <span className="text-[10px] text-[#74777f]">{fmtRate(lteCmp.carded)}</span>
                                <span className="text-[9px] text-[#a1a5ab]">/ {fmtRate(gtCmp.carded)}</span>
                                <span className="text-[8px] text-[#a1a5ab] uppercase tracking-wider ml-1">carded</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4 flex justify-between">
              <p className="text-[10px] text-[#44474e] italic">
                * Top row: broker-email rate (Spec ≤80% LVR / Std &gt;80% LVR). Bottom row: carded rate from interest.co.nz. Amber dot flags ≥{DISCREPANCY_BPS} bps difference.
              </p>
              <p className="text-[10px] text-[#44474e] italic">
                Updated {lastRefresh}
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* FAB */}
      <div className="fixed bottom-8 right-8 z-50 print:hidden">
        <button
          onClick={fetchData}
          className="w-14 h-14 bg-[#031f41] text-white rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
          title="Refresh data"
        >
          <span className={`material-symbols-outlined ${loading ? 'animate-spin' : ''}`}>refresh</span>
        </button>
      </div>

      {/* TAT-detail modal — opens when a bank card's Turnaround row is clicked */}
      {tatDetailBankId && (() => {
        const b = banks.find(x => x.id === tatDetailBankId);
        if (!b) return null;
        return (
          <TatDetailModal
            bank={b}
            pinUnlocked={tatPinUnlocked}
            onPinUnlock={() => setTatPinUnlocked(true)}
            onClose={() => setTatDetailBankId(null)}
            onSaved={(turnaround) => applyTurnaroundUpdate(b.id, turnaround)}
          />
        );
      })()}
    </div>
  );
}

// ===== Components =====

function NavLink({ icon, label, href = '#', active = false }: { icon: string; label: string; href?: string; active?: boolean }) {
  return (
    <a
      href={href}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
        active
          ? 'text-[#031f41] font-bold bg-white/50'
          : 'text-slate-600 hover:text-[#031f41] hover:bg-white/30'
      }`}
    >
      <span className="material-symbols-outlined">{icon}</span>
      {label}
    </a>
  );
}

function StatusBadge({ tone, label }: { tone: 'active' | 'warn' | 'critical'; label: string }) {
  const cls =
    tone === 'active'   ? 'bg-[#a3d8fe] text-[#064c6b]' :
    tone === 'warn'     ? 'bg-[#fff3cd] text-[#856404]' :
                          'bg-[#ffdad8] text-[#92001c]';
  return (
    <span className={`text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center border-b border-[#c4c6cf]/20 pb-2">
      <span className="text-[11px] text-[#44474e] font-medium">{label}</span>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-[#879ec6] font-bold">{label}</p>
      <p className="text-sm font-bold text-white mt-1">{value}</p>
    </div>
  );
}

/**
 * The "Turnaround" row on each bank card. Shows ONLY the retail TAT value(s)
 * — retail being any key whose name matches /retail/i. Clicking anywhere on
 * the row opens the full TAT-detail modal for that bank.
 *
 * Display rules:
 *   0 retail entries  → "—"
 *   1 retail entry    → "{days} days" + "updated {shortDate}" stamp
 *   2+ retail entries → "{a}/{b}{/c...} days" with tooltip naming each key,
 *                       using the most recent updatedAt stamp
 * Stale (≥14 days): stamp coloured amber.
 */
function TurnaroundRow({ bank, onOpen }: { bank: Bank; onOpen: () => void }) {
  // Persisted shape is always TurnaroundMap after the db shim normalises on
  // every write (see mergeBankData in app/lib/db.ts). The type union allows
  // LegacyTurnaround only to keep parser-write paths typechecked.
  const tmap = bank.data.turnaround as TurnaroundMap | undefined;
  const retails = pickRetailEntries(tmap);

  let display: React.ReactNode = '—';
  let stampIso: string | undefined;
  let tooltip = 'Click to view all turnaround categories';

  if (retails.length === 1) {
    const [{ entry }] = retails;
    display = (
      <>
        {String(entry.days)}<span className="text-[#44474e] font-normal text-xs"> days</span>
      </>
    );
    stampIso = entry.updatedAt;
  } else if (retails.length > 1) {
    // Sort so "Priority" comes first, then everything else alphabetically.
    const sorted = [...retails].sort((a, b) => {
      const ap = /priority/i.test(a.key) ? 0 : 1;
      const bp = /priority/i.test(b.key) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.key.localeCompare(b.key);
    });
    display = (
      <>
        {sorted.map((r, i) => (
          <React.Fragment key={r.key}>
            {i > 0 && <span className="text-[#44474e]"> / </span>}
            {String(r.entry.days)}
          </React.Fragment>
        ))}
        <span className="text-[#44474e] font-normal text-xs"> days</span>
      </>
    );
    stampIso = mostRecentUpdatedAt(sorted);
    tooltip = sorted.map(r => `${r.key}: ${r.entry.days} days`).join(' · ');
  }

  const stale = isStale(stampIso);
  return (
    <div
      className="cursor-pointer group"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      title={tooltip}
    >
      <div className="flex justify-between items-center border-b border-[#c4c6cf]/20 pb-2">
        <span className="text-[11px] text-[#44474e] font-medium group-hover:text-[#031f41]">Turnaround</span>
        <span className="text-sm font-bold text-[#031f41]">{display}</span>
      </div>
      {stampIso && (
        <div className="flex justify-end pt-1">
          <span className={`text-[9px] ${stale ? 'text-[#b45309]' : 'text-[#74777f]'}`}>
            updated {fmtShortDate(stampIso)}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Full-category TAT detail modal. Shows every key in `bank.data.turnaround`
 * as a table row with an Edit button per row. On Edit, prompts for the PIN
 * (once per session) via /api/tat-pin. After unlock, the inline input POSTs
 * to /api/tat-override with the x-tat-pin header; the response returns the
 * updated turnaround map which the caller patches into local state via
 * `onSaved`.
 */
function TatDetailModal({
  bank,
  pinUnlocked,
  onPinUnlock,
  onClose,
  onSaved,
}: {
  bank: Bank;
  pinUnlocked: boolean;
  onPinUnlock: () => void;
  onClose: () => void;
  onSaved: (turnaround: TurnaroundMap) => void;
}) {
  // Narrow the union for the modal. Persisted shape is always TurnaroundMap.
  const tmap = (bank.data.turnaround as TurnaroundMap | undefined) ?? {};
  const entries = Object.entries(tmap);

  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinChecking, setPinChecking] = useState(false);
  const [pinValue, setPinValue] = useState<string | null>(null); // remembered for API calls this session

  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const submitPin = async () => {
    setPinError('');
    setPinChecking(true);
    try {
      const res = await fetch('/api/tat-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (res.ok) {
        setPinValue(pinInput);
        onPinUnlock();
      } else {
        setPinError('Incorrect PIN');
      }
    } catch {
      setPinError('PIN check failed');
    }
    setPinChecking(false);
  };

  const saveOverride = async (category: string, daysRaw: string) => {
    setSaveError('');
    setSaving(true);
    try {
      // Pass as a number if it's purely numeric, else as a free-form string
      // (so "up to 7" style inputs survive).
      const parsed = daysRaw.trim();
      const days: number | string =
        parsed !== '' && Number.isFinite(Number(parsed)) ? Number(parsed) : parsed;
      const res = await fetch('/api/tat-override', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tat-pin': pinValue ?? '',
        },
        body: JSON.stringify({ bankId: bank.id, category, days }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Save failed');
      onSaved(body.turnaround as TurnaroundMap);
      setEditKey(null);
      setEditValue('');
      setNewKey('');
      setNewValue('');
    } catch (err: any) {
      setSaveError(err.message || 'Save failed');
    }
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#e5e8ed] flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#44474e]">Turnaround Times</p>
            <h3 className="text-xl font-bold text-[#031f41]" style={{ fontFamily: 'Manrope, sans-serif' }}>{bank.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="material-symbols-outlined text-[#44474e] hover:bg-[#f1f4f9] p-2 rounded-lg"
            aria-label="Close"
          >close</button>
        </div>

        <div className="flex-1 overflow-auto">
          {entries.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#74777f]">
              No turnaround categories recorded for {bank.name}.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#f7f9fe] text-[10px] font-black uppercase tracking-widest text-[#44474e]">
                <tr>
                  <th className="px-6 py-3 text-left">Category</th>
                  <th className="px-6 py-3 text-left">Days</th>
                  <th className="px-6 py-3 text-left">Updated</th>
                  <th className="px-6 py-3 text-left">Source</th>
                  <th className="px-6 py-3 text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e8ed]">
                {entries.map(([key, entry]) => {
                  const isEditing = editKey === key;
                  const stale = isStale(entry.updatedAt);
                  return (
                    <tr key={key}>
                      <td className="px-6 py-3 font-medium text-[#031f41]">{key}</td>
                      <td className="px-6 py-3">
                        {isEditing ? (
                          <input
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="border border-[#c4c6cf] rounded px-2 py-1 text-sm w-24"
                          />
                        ) : (
                          <span className="font-bold text-[#031f41]">{String(entry.days)}</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <span className={stale ? 'text-[#b45309]' : 'text-[#44474e]'}>
                          {fmtShortDate(entry.updatedAt)}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                            entry.source === 'manual'
                              ? 'bg-[#e0e7ff] text-[#3730a3]'
                              : 'bg-[#f1f4f9] text-[#44474e]'
                          }`}
                        >
                          {entry.source}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => saveOverride(key, editValue)}
                              disabled={saving || !pinUnlocked}
                              className="px-3 py-1 bg-[#031f41] text-white text-xs rounded disabled:opacity-50"
                            >
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              onClick={() => { setEditKey(null); setEditValue(''); }}
                              className="px-3 py-1 border border-[#c4c6cf] text-xs rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditKey(key); setEditValue(String(entry.days)); }}
                            disabled={!pinUnlocked}
                            className="text-xs font-bold text-[#2b6485] hover:underline disabled:text-[#a1a5ab] disabled:no-underline"
                            title={pinUnlocked ? 'Edit this value' : 'Enter the TAT PIN below to enable editing'}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Add-new-category row (visible only when PIN unlocked) */}
          {pinUnlocked && (
            <div className="px-6 py-4 border-t border-[#e5e8ed] bg-[#f7f9fe]">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#44474e] mb-2">Add Category</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Category (e.g. Priority Retail)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="flex-1 border border-[#c4c6cf] rounded px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  placeholder="Days"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-24 border border-[#c4c6cf] rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={() => saveOverride(newKey.trim(), newValue)}
                  disabled={saving || !newKey.trim() || !newValue.trim()}
                  className="px-3 py-1 bg-[#031f41] text-white text-xs rounded disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {saveError && (
            <div className="px-6 py-3 text-xs text-[#93000a] bg-[#ffdad6]">{saveError}</div>
          )}
        </div>

        {/* PIN gate footer */}
        <div className="px-6 py-4 border-t border-[#e5e8ed] bg-white">
          {pinUnlocked ? (
            <p className="text-[11px] text-[#2b6485] font-medium">Edit mode unlocked. Manual edits are flagged `manual` and survive auto ingests.</p>
          ) : (
            <div>
              <p className="text-[11px] text-[#44474e] mb-2">Enter the TAT admin PIN to enable editing.</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); submitPin(); }}
              >
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="PIN"
                  className="flex-1 border border-[#c4c6cf] rounded px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={pinChecking || !pinInput}
                  className="px-4 py-2 bg-[#031f41] text-white text-xs font-bold rounded disabled:opacity-50"
                >
                  {pinChecking ? 'Checking...' : 'Unlock'}
                </button>
              </form>
              {pinError && <p className="text-[11px] text-[#93000a] mt-2">{pinError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
