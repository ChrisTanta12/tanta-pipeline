'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { BankData, BankId } from '@/app/lib/types';

type Bank = { id: BankId; name: string; data: BankData; updatedAt: string };
type CustomerType = 'existing' | 'new';
type RateMode = 'fixed' | 'floating';

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
              const tl = b.data.trafficLights?.lte80?.[customer];
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
                    <Row label="Turnaround">
                      <span className="text-sm font-bold text-[#031f41]">
                        {b.data.turnaround?.retail ?? '—'}<span className="text-[#44474e]"> / </span>
                        {b.data.turnaround?.business ?? '—'}<span className="text-[#44474e] font-normal text-xs"> days</span>
                      </span>
                    </Row>
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

          {/* PAYMENT FREQUENCIES + MARKET INSIGHTS */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
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
                          return (
                            <td key={`${b.id}-${term.key}`} className="px-8 py-4 text-center border-l border-[#c4c6cf]/5">
                              <div className="flex items-baseline justify-center gap-2">
                                <span className="text-sm font-extrabold text-[#031f41]">{fmtRate(r?.lte80)}</span>
                                <span className="text-[10px] text-[#44474e] font-medium">/ {fmtRate(r?.gt80)}</span>
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
                * Spec = ≤80% LVR (special). Std = &gt;80% LVR (standard + LEP). Source: broker-channel emails, ingested daily.
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
