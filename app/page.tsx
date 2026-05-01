'use client';

import Link from 'next/link';

/**
 * Landing page — lightweight nav into the four dashboards.
 * Replaces the previous root which loaded the full pipeline dashboard
 * (now at /pipeline). Keeps initial load instant; user picks which
 * heavy dashboard to open.
 *
 * Design: centred, plain, fast. Logo slides in from above on first paint;
 * buttons fade in just behind it. No data fetching, no auth, no JS bundle
 * beyond Next's Link primitive.
 */

type Tile = {
  href: string;
  label: string;
  description: string;
};

const TILES: Tile[] = [
  {
    href: '/pipeline',
    label: 'Pipeline',
    description: 'Trail CRM deals, settlements, commission YTD',
  },
  {
    href: '/lenders',
    label: 'Lenders',
    description: 'Live bank rate card + turnaround times',
  },
  {
    href: '/break-fee',
    label: 'Break Fee',
    description: 'Calculator using live wholesale swap rates',
  },
  {
    href: '/finance',
    label: 'Finance',
    description: 'Profit First overlay + cycle reporting',
  },
];

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-neutral-50">
      <style>{`
        @keyframes slideInLogo {
          from { opacity: 0; transform: translateY(-32px); }
          to   { opacity: 1; transform: translateY(0);     }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .logo-anim    { animation: slideInLogo 700ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .tiles-anim   { animation: fadeInUp 600ms 350ms cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      <img
        src="/tanta-logo.png"
        alt="Tanta"
        className="logo-anim w-40 h-auto mb-12 select-none"
        draggable={false}
      />

      <div className="tiles-anim grid grid-cols-2 gap-3 w-full max-w-md">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            className="
              group block rounded-xl border border-neutral-200 bg-white px-5 py-6
              hover:border-[#1d3557] hover:shadow-sm transition-all
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d3557]
            "
          >
            <div className="text-base font-semibold text-[#1d3557] group-hover:text-[#1d3557]">
              {t.label}
            </div>
            <div className="text-xs text-neutral-500 mt-1 leading-snug">
              {t.description}
            </div>
          </Link>
        ))}
      </div>

      <div className="tiles-anim mt-12 text-[11px] text-neutral-400">
        Tanta Mortgage Brokers
      </div>
    </main>
  );
}
