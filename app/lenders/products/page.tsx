'use client';

import React from 'react';
import type { BankId } from '@/app/lib/types';

const BANK_ORDER: BankId[] = ['anz', 'asb', 'bnz', 'westpac', 'kiwibank'];

const BANK_HEADER: Record<BankId, { label: string; bg: string; fg: string }> = {
  anz:      { label: 'ANZ',      bg: '#22c4e6', fg: '#ffffff' }, // cyan
  asb:      { label: 'ASB',      bg: '#eab308', fg: '#111827' }, // yellow
  bnz:      { label: 'BNZ',      bg: '#031f41', fg: '#ffffff' }, // navy
  westpac:  { label: 'WESTPAC',  bg: '#ba1a1a', fg: '#ffffff' }, // red
  kiwibank: { label: 'KIWIBANK', bg: '#22c55e', fg: '#ffffff' }, // green
};

type Cell = { value: string; highlight?: boolean; bold?: boolean };
type Row = { label: string; cells: Record<BankId, Cell> };

const DATA_AS_OF = '20 March 2026';

const ROWS: Row[] = [
  {
    label: 'Offset',
    cells: {
      anz:      { value: 'No' },
      asb:      { value: 'No' },
      bnz:      { value: 'Yes', highlight: true, bold: true },
      westpac:  { value: 'Yes' },
      kiwibank: { value: 'Yes' },
    },
  },
  {
    label: 'How many accounts can be Offset',
    cells: {
      anz:      { value: 'N/A' },
      asb:      { value: 'N/A' },
      bnz:      { value: '50', highlight: true, bold: true },
      westpac:  { value: '10' },
      kiwibank: { value: '8' },
    },
  },
  {
    label: 'Increase weekly repayments',
    cells: {
      anz:      { value: 'Change Loan Term' },
      asb:      { value: '$500/fn max' },
      bnz:      { value: '5% (incl lump sum)', highlight: true },
      westpac:  { value: '20% over min' },
      kiwibank: { value: '5% (incl lump sum)' },
    },
  },
  {
    label: 'Lump sum repayment options (no fees)',
    cells: {
      anz:      { value: '5%' },
      asb:      { value: 'No' },
      bnz:      { value: '5%' },
      westpac:  { value: 'No' },
      kiwibank: { value: '5%' },
    },
  },
  {
    label: 'Business Banking addback',
    cells: {
      anz:      { value: 'Yes' },
      asb:      { value: 'Yes', highlight: true },
      bnz:      { value: 'Some' },
      westpac:  { value: 'Some' },
      kiwibank: { value: 'Some' },
    },
  },
  {
    label: 'Revolving Credit',
    cells: {
      anz:      { value: 'Yes but fees ($12.50 p/m)' },
      asb:      { value: 'Yes', highlight: true },
      bnz:      { value: 'P&I' },
      westpac:  { value: 'Yes' },
      kiwibank: { value: 'P&I' },
    },
  },
  {
    label: 'Revolving Credit Limit',
    cells: {
      anz:      { value: '$350k' },
      asb:      { value: '$500k', highlight: true },
      bnz:      { value: '$500k' },
      westpac:  { value: '$500k+' },
      kiwibank: { value: '$500k' },
    },
  },
  {
    label: 'Multi-household Assessment',
    cells: {
      anz:      { value: 'No' },
      asb:      { value: 'Yes', highlight: true },
      bnz:      { value: 'No' },
      westpac:  { value: 'No' },
      kiwibank: { value: 'No' },
    },
  },
  {
    label: 'Availability of Funds',
    cells: {
      anz:      { value: 'High', highlight: true },
      asb:      { value: 'High', highlight: true },
      bnz:      { value: 'Medium' },
      westpac:  { value: 'Medium' },
      kiwibank: { value: 'Low' },
    },
  },
  {
    label: 'Min Repayment Frequency',
    cells: {
      anz:      { value: 'Weekly', highlight: true },
      asb:      { value: 'Fortnightly' },
      bnz:      { value: 'Weekly', highlight: true },
      westpac:  { value: 'Fortnightly' },
      kiwibank: { value: 'Weekly', highlight: true },
    },
  },
  {
    label: 'Kiwi Owned',
    cells: {
      anz:      { value: 'No' },
      asb:      { value: 'No' },
      bnz:      { value: 'No' },
      westpac:  { value: 'No' },
      kiwibank: { value: 'Yes', highlight: true },
    },
  },
  {
    label: 'Kāinga Ora First Home Loan',
    cells: {
      anz:      { value: 'No' },
      asb:      { value: 'Yes' },
      bnz:      { value: 'No' },
      westpac:  { value: 'Yes', highlight: true },
      kiwibank: { value: 'Yes', highlight: true },
    },
  },
  {
    label: 'Available Limits / Redraw',
    cells: {
      anz:      { value: 'No' },
      asb:      { value: 'No' },
      bnz:      { value: 'No' },
      westpac:  { value: 'Yes', highlight: true },
      kiwibank: { value: 'No' },
    },
  },
  {
    label: 'Broker Access',
    cells: {
      anz:      { value: 'No' },
      asb:      { value: 'No' },
      bnz:      { value: 'No' },
      westpac:  { value: 'No' },
      kiwibank: { value: 'No' },
    },
  },
];

export default function LenderProductsPage() {
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
          <NavLink icon="compare_arrows" label="Bank Comparisons" href="/lenders" />
          <NavLink icon="trending_up" label="Market Rates" />
          <NavLink icon="fact_check" label="Lender Product Comparisons" href="/lenders/products" active />
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
              <span className="text-[#44474e] text-[10px] font-bold uppercase tracking-[0.2em] mb-2 block">Policy &amp; Product Intelligence</span>
              <h1 className="text-4xl font-extrabold text-[#031f41] tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Lender Product Comparisons
              </h1>
              <p className="text-xs text-[#44474e] mt-2">
                Green cells flag the most favourable option in each row. Data as of {DATA_AS_OF}.
              </p>
            </div>
            <button
              onClick={() => window.print()}
              className="bg-[#dfe3e8] px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#c4c6cf] transition-colors text-[#031f41]"
            >
              <span className="material-symbols-outlined text-lg">download</span>
              Export PDF
            </button>
          </div>

          {/* COMPARISON TABLE */}
          <div className="bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="px-6 py-4 text-[11px] font-black text-[#44474e] uppercase tracking-widest bg-[#e5e8ed]">
                      Product / Policy
                    </th>
                    {BANK_ORDER.map(id => {
                      const h = BANK_HEADER[id];
                      return (
                        <th
                          key={id}
                          className="px-6 py-4 text-[12px] font-black uppercase tracking-widest text-center"
                          style={{ backgroundColor: h.bg, color: h.fg, fontFamily: 'Manrope, sans-serif' }}
                        >
                          {h.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e8ed]">
                  {ROWS.map((row, i) => (
                    <tr key={row.label} className={i % 2 === 1 ? 'bg-[#031f41]/[0.015]' : ''}>
                      <td className="px-6 py-3 font-semibold text-[#031f41] text-sm">
                        {row.label}
                      </td>
                      {BANK_ORDER.map(id => {
                        const c = row.cells[id];
                        const hl = c.highlight;
                        return (
                          <td
                            key={id}
                            className="px-6 py-3 text-center border-l border-[#c4c6cf]/10"
                            style={hl ? { backgroundColor: '#a7f3d0' } : undefined}
                          >
                            <span className={`text-sm ${c.bold ? 'font-extrabold' : 'font-medium'} ${hl ? 'text-[#065f46]' : 'text-[#031f41]'}`}>
                              {c.value}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-[10px] text-[#44474e] italic">
            * Product &amp; policy settings summarised from broker-channel materials and current criteria guides. Check the individual lender&apos;s current policy before committing to a strategy.
          </p>
        </div>
      </main>
    </div>
  );
}

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
