'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { BankData, BankId } from '@/app/lib/types';

type Bank = { id: BankId; name: string; data: BankData; updatedAt: string };

const BANK_ORDER: BankId[] = ['westpac', 'asb', 'bnz', 'anz', 'kiwibank'];
const TERM_ORDER: Array<{ key: string; label: string }> = [
  { key: '6mo', label: '6 month' },
  { key: '1y', label: '1 year' },
  { key: '18mo', label: '18 months' },
  { key: '2y', label: '2 year' },
  { key: '3y', label: '3 year' },
  { key: '4y', label: '4 year' },
  { key: '5y', label: '5 year' },
  { key: 'floating', label: 'Floating' },
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

function fmtMoney(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return '$' + v.toLocaleString('en-NZ');
  return String(v);
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function lightColor(status?: string): string {
  if (!status) return 'bg-gray-300';
  const s = status.toLowerCase();
  if (s.includes('pre-approval & live') || s.includes('preapproval & live')) return 'bg-green-500';
  if (s.includes('live only')) return 'bg-yellow-500';
  if (s.includes('no')) return 'bg-red-500';
  return 'bg-gray-400';
}

export default function LendersPage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bank-rates');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // sort to BANK_ORDER
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

  if (loading && banks.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-surface-container-high border-t-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-on-surface-variant">Loading bank rates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen">
      {/* Sidebar */}
      <aside className="h-screen w-64 fixed left-0 top-0 bg-surface-container-low flex flex-col py-6 pl-4 pr-0 overflow-y-auto z-50">
        <div className="mb-10 px-4">
          <h1 className="text-lg font-bold text-[#0B4E6F] tracking-tighter">Tanta</h1>
          <p className="text-xs text-on-surface-variant font-medium">Mortgage Architect</p>
        </div>
        <nav className="flex-grow space-y-1">
          <a className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] hover:bg-white/40 transition-all duration-200" href="/">
            <span className="material-symbols-outlined">account_tree</span>
            <span className="text-sm">Pipeline</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] hover:bg-white/40 transition-all duration-200" href="#">
            <span className="material-symbols-outlined">description</span>
            <span className="text-sm">Applications</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] hover:bg-white/40 transition-all duration-200" href="#">
            <span className="material-symbols-outlined">folder_shared</span>
            <span className="text-sm">Client Vault</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 bg-white text-[#228EBF] font-bold rounded-l-full shadow-sm" href="/lenders">
            <span className="material-symbols-outlined">account_balance</span>
            <span className="text-sm">Lenders</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] hover:bg-white/40 transition-all duration-200" href="#">
            <span className="material-symbols-outlined">analytics</span>
            <span className="text-sm">Reports</span>
          </a>
        </nav>
      </aside>

      <main className="ml-64 min-h-screen pb-8">
        {/* Header */}
        <header className="flex justify-between items-center px-8 w-full sticky top-0 z-40 bg-surface-container-low h-16">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Lenders</h2>
            <p className="text-xs text-on-surface-variant">Live rate card, traffic lights, turnaround times across our major banks</p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-on-surface-variant">
              {loading ? 'Refreshing...' : `Updated ${fmtDate(fetchedAt)}`}
            </p>
            <button onClick={fetchData} disabled={loading} className={`w-10 h-10 rounded-full flex items-center justify-center text-white bg-primary ${loading ? 'animate-pulse' : ''}`} title="Refresh">
              <span className="material-symbols-outlined text-lg">refresh</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-8 mt-4 p-4 bg-error-container text-on-error-container rounded-xl text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="p-8 space-y-6">
          {/* Bank headers row */}
          <div className="grid gap-4" style={{ gridTemplateColumns: `180px repeat(${banks.length}, minmax(0, 1fr))` }}>
            <div />
            {banks.map(b => (
              <div key={b.id} className="bg-surface-container-lowest rounded-xl shadow-md p-4 text-center">
                <p className="text-lg font-black text-[#0B4E6F]">{b.name}</p>
                <p className="text-[10px] text-on-surface-variant mt-1">
                  Last update {fmtDate(b.updatedAt)}
                </p>
                {b.data.lastSourceEmail && (
                  <p className="text-[10px] text-on-surface-variant truncate" title={b.data.lastSourceEmail.subject}>
                    src: {b.data.lastSourceEmail.subject.slice(0, 30)}…
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Rate Card */}
          <Section title="Rate Card" subtitle="≤ 80% LVR / > 80% LVR">
            <div className="grid gap-px bg-surface-container-high rounded-xl overflow-hidden" style={{ gridTemplateColumns: `180px repeat(${banks.length}, minmax(0, 1fr))` }}>
              <HeaderCell>Term</HeaderCell>
              {banks.map(b => (
                <HeaderCell key={b.id} className="text-center">
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                    <span>≤80%</span>
                    <span>&gt;80%</span>
                  </div>
                </HeaderCell>
              ))}

              {TERM_ORDER.map(term => (
                <React.Fragment key={term.key}>
                  <Cell className="font-semibold">{term.label}</Cell>
                  {banks.map(b => {
                    const r = b.data.rateCard?.[term.key];
                    return (
                      <Cell key={`${b.id}-${term.key}`} className="text-center">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <span>{fmtRate(r?.lte80)}</span>
                          <span className="text-on-surface-variant">{fmtRate(r?.gt80)}</span>
                        </div>
                      </Cell>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </Section>

          {/* Traffic lights */}
          <Section title="Traffic Lights" subtitle="Approval appetite by LVR band / customer type">
            <div className="grid gap-px bg-surface-container-high rounded-xl overflow-hidden" style={{ gridTemplateColumns: `180px repeat(${banks.length}, minmax(0, 1fr))` }}>
              <HeaderCell>LVR / Customer</HeaderCell>
              {banks.map(b => <HeaderCell key={b.id} className="text-center">{b.name}</HeaderCell>)}

              {(['lte80', '80_90'] as const).flatMap(lvr =>
                (['existing', 'new'] as const).map(cust => (
                  <React.Fragment key={`${lvr}-${cust}`}>
                    <Cell className="font-semibold text-xs">
                      {lvr === 'lte80' ? '≤ 80%' : '80-90%'} · {cust === 'existing' ? 'Existing' : 'New'}
                    </Cell>
                    {banks.map(b => {
                      const v = b.data.trafficLights?.[lvr]?.[cust];
                      return (
                        <Cell key={`${b.id}-${lvr}-${cust}`} className="text-center">
                          <div className="flex items-center gap-2 justify-center">
                            <span className={`w-2.5 h-2.5 rounded-full ${lightColor(v)}`} />
                            <span className="text-xs">{v || '—'}</span>
                          </div>
                        </Cell>
                      );
                    })}
                  </React.Fragment>
                ))
              )}
            </div>
          </Section>

          {/* Turnaround */}
          <Section title="Turnaround Times" subtitle="Business days (retail / business)">
            <div className="grid gap-px bg-surface-container-high rounded-xl overflow-hidden" style={{ gridTemplateColumns: `180px repeat(${banks.length}, minmax(0, 1fr))` }}>
              <HeaderCell>Segment</HeaderCell>
              {banks.map(b => <HeaderCell key={b.id} className="text-center">{b.name}</HeaderCell>)}

              <Cell className="font-semibold">Retail</Cell>
              {banks.map(b => (
                <Cell key={`${b.id}-ret`} className="text-center text-lg font-bold text-primary">
                  {b.data.turnaround?.retail ?? '—'}
                </Cell>
              ))}

              <Cell className="font-semibold">Business</Cell>
              {banks.map(b => (
                <Cell key={`${b.id}-biz`} className="text-center text-lg font-bold text-primary">
                  {b.data.turnaround?.business ?? '—'}
                </Cell>
              ))}
            </div>
          </Section>

          {/* Cashback + LEP + Fees */}
          <Section title="Cash Back, LEP & Fees">
            <div className="grid gap-px bg-surface-container-high rounded-xl overflow-hidden" style={{ gridTemplateColumns: `180px repeat(${banks.length}, minmax(0, 1fr))` }}>
              <HeaderCell>Field</HeaderCell>
              {banks.map(b => <HeaderCell key={b.id} className="text-center">{b.name}</HeaderCell>)}

              <Cell className="font-semibold text-xs">Cashback ≤80%</Cell>
              {banks.map(b => <Cell key={`${b.id}-cb80`} className="text-center">{fmtPct(b.data.cashback?.pctLte80)}</Cell>)}

              <Cell className="font-semibold text-xs">Cashback FHB</Cell>
              {banks.map(b => <Cell key={`${b.id}-cbfhb`} className="text-center">{fmtMoney(b.data.cashback?.fhb)}</Cell>)}

              <Cell className="font-semibold text-xs">LEP 80-85%</Cell>
              {banks.map(b => <Cell key={`${b.id}-lep85`} className="text-center">{typeof b.data.lep?.['80_85'] === 'number' ? fmtPct(b.data.lep['80_85']) : (b.data.lep?.['80_85'] ?? '—')}</Cell>)}

              <Cell className="font-semibold text-xs">LEP 85-90%</Cell>
              {banks.map(b => <Cell key={`${b.id}-lep90`} className="text-center">{typeof b.data.lep?.['85_90'] === 'number' ? fmtPct(b.data.lep['85_90']) : (b.data.lep?.['85_90'] ?? '—')}</Cell>)}

              <Cell className="font-semibold text-xs">Application fee</Cell>
              {banks.map(b => <Cell key={`${b.id}-appfee`} className="text-center text-xs">{b.data.fees?.application ?? '—'}</Cell>)}

              <Cell className="font-semibold text-xs">NUR / RRA</Cell>
              {banks.map(b => <Cell key={`${b.id}-nur`} className="text-center text-xs">{b.data.fees?.nurRra ?? '—'}</Cell>)}

              <Cell className="font-semibold text-xs">Service test rate</Cell>
              {banks.map(b => <Cell key={`${b.id}-str`} className="text-center font-bold">{fmtRate(b.data.serviceRate)}</Cell>)}
            </div>
          </Section>

          {/* Commission */}
          <Section title="Commission">
            <div className="grid gap-px bg-surface-container-high rounded-xl overflow-hidden" style={{ gridTemplateColumns: `180px repeat(${banks.length}, minmax(0, 1fr))` }}>
              <HeaderCell>Field</HeaderCell>
              {banks.map(b => <HeaderCell key={b.id} className="text-center">{b.name}</HeaderCell>)}

              <Cell className="font-semibold text-xs">Upfront</Cell>
              {banks.map(b => <Cell key={`${b.id}-up`} className="text-center">{fmtPct(b.data.commission?.upfront as number | null)}</Cell>)}

              <Cell className="font-semibold text-xs">Trail</Cell>
              {banks.map(b => <Cell key={`${b.id}-tr`} className="text-center">{fmtPct(b.data.commission?.trail as number | null)}</Cell>)}

              <Cell className="font-semibold text-xs">Revolving credit</Cell>
              {banks.map(b => <Cell key={`${b.id}-rc`} className="text-center text-xs">{(b.data.commission?.rc as string) ?? '—'}</Cell>)}

              <Cell className="font-semibold text-xs">Refix</Cell>
              {banks.map(b => <Cell key={`${b.id}-rf`} className="text-center">{fmtMoney(b.data.commission?.refix)}</Cell>)}
            </div>
          </Section>

          {/* BDM Contacts */}
          <Section title="BDM Contacts">
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${banks.length}, minmax(0, 1fr))` }}>
              {banks.map(b => (
                <div key={b.id} className="bg-surface-container-lowest rounded-xl shadow-md p-4">
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase">{b.name}</p>
                  <p className="text-sm font-bold mt-1">{b.data.bdm?.name ?? '—'}</p>
                  <p className="text-xs text-on-surface-variant">{b.data.bdm?.phone ?? ''}</p>
                  <p className="text-xs text-on-surface-variant truncate" title={b.data.bdm?.email}>{b.data.bdm?.email ?? ''}</p>
                  {b.data.bdm2 && (
                    <div className="mt-3 pt-3 border-t border-surface-container-high">
                      <p className="text-[10px] text-on-surface-variant">{b.data.bdm2.role ?? 'Secondary'}</p>
                      <p className="text-sm font-bold">{b.data.bdm2.name}</p>
                      <p className="text-xs text-on-surface-variant">{b.data.bdm2.phone}</p>
                      <p className="text-xs text-on-surface-variant truncate">{b.data.bdm2.email}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-sm font-bold uppercase tracking-tight text-on-surface">{title}</h3>
        {subtitle && <p className="text-xs text-on-surface-variant">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function HeaderCell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-container-lowest px-3 py-2 text-[11px] font-bold uppercase text-on-surface-variant ${className}`}>
      {children}
    </div>
  );
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-container-lowest px-3 py-2 text-sm ${className}`}>
      {children}
    </div>
  );
}
