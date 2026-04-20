'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// ===== Types =====
interface MortgageApplication {
  lender?: string;
  preApprovalExpiryDate?: string;
  expectedSettlementDate?: string;
}
interface ClientInterview {
  goal?: string; plan?: string; challenges?: string; timing?: string;
}
interface Opportunity {
  opportunityId: number;
  profileName: string;
  adviserName: string;
  pipelineName: string;
  stageName: string;
  stageId: number;
  profileId: number;
  adviserId: number;
  pipelineId: number;
  value: number | string;
  source: string;
  referrer: string;
  closedDate: string;
  status: string;
  createdTimestamp: string;
  modifiedTimestamp: string;
  isProfileArchived?: boolean;
  mortgageApplication?: MortgageApplication;
  opportunityType?: string;
  clientInterview?: ClientInterview;
  daysInCurrentStage?: number | null;
  stageEnteredAt?: string | null;
  profileRank?: string | null;
  profileStatus?: string | null;
}

// ===== Helpers =====
function numVal(v: number | string | undefined): number {
  return parseFloat(String(v || 0)) || 0;
}
function fmtCurrency(v: number): string {
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'm';
  if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'k';
  return '$' + Math.round(v).toLocaleString();
}
function fmtBigCurrency(v: number): string {
  return '$' + v.toLocaleString('en-NZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDate(d?: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysUntil(d?: string): number {
  if (!d) return 999;
  return Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}
function daysSince(d?: string): number {
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24)));
}
function isThisMonth(d?: string): boolean {
  if (!d) return false;
  const date = new Date(d);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}
function isThisYear(d?: string): boolean {
  if (!d) return false;
  return new Date(d).getFullYear() === new Date().getFullYear();
}
function pct(num: number, denom: number): string {
  if (!denom) return '0%';
  return Math.round((num / denom) * 100) + '%';
}
function pctNum(num: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((num / denom) * 100);
}

// Advisers whose deals should NOT appear in dashboard metrics — usually ex-staff
// whose open opportunities haven't been reassigned yet. Edit this list when
// someone joins or leaves. Matched on exact adviserName.
const EXCLUDED_ADVISERS = new Set<string>([
  'Aaron Cattell',
  'Alexey Papyshev',
  'Luke Stockman',
]);

// Only count opportunities in this Trail pipeline. Everything else (Mortgage
// Servicing, Mortgage Prospecting, Insurance Advice, KiwiSaver, etc.) is
// excluded from all dashboard metrics.
const INCLUDED_PIPELINE = 'Mortgage Advice';

// Stage definitions
const PIPELINE_STAGES = ['Opportunity', 'Submitted', 'PreApproval', 'Unconditional', 'BuildContract'];
const COMPLETED_STAGES = ['Lost', 'Settled'];
const STAGE_COLORS: Record<string, string> = {
  Lost: 'bg-error', Settled: 'bg-primary', Opportunity: 'bg-[#EAB308]',
  Submitted: 'bg-secondary', PreApproval: 'bg-[#84CC16]', Unconditional: 'bg-surface-tint',
  BuildContract: 'bg-[#F97316]', // orange — between unconditional and settled
  'Book Strategy Session': 'bg-[#EAB308]', 'Deal Submitted': 'bg-secondary',
  'Conditional Approval': 'bg-[#84CC16]', 'House Under Contract': 'bg-surface-tint',
  'Loan Settled': 'bg-primary', 'Commission Received': 'bg-primary',
};

// Commission rates by lender
const COMMISSION_RATES: Record<string, number> = {
  'ANZ': 0.0085,
  'ASB': 0.0085,
  'BNZ': 0.006,
  'Kiwibank': 0.006,
  'KiwiBank': 0.006,
  'Westpac': 0.009,
};
const DEFAULT_COMMISSION_RATE = 0.0075; // fallback for unknown lenders

function getCommissionRate(lender?: string): number {
  if (!lender) return DEFAULT_COMMISSION_RATE;
  // Try exact match first, then case-insensitive partial match
  if (COMMISSION_RATES[lender]) return COMMISSION_RATES[lender];
  const lower = lender.toLowerCase();
  for (const [key, rate] of Object.entries(COMMISSION_RATES)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return rate;
  }
  return DEFAULT_COMMISSION_RATE;
}

function getCommission(opp: { value: number | string; mortgageApplication?: MortgageApplication }): number {
  return numVal(opp.value) * getCommissionRate(opp.mortgageApplication?.lender);
}

// Map Trail stage names to dashboard buckets.
// Trail suffixes stages with "*Broker" / "*CSM" / "* Close Deal" etc., so we
// match on keywords rather than exact strings. Double-spaces and case variations
// also happen; normalise before matching.
//
// Mappings cover Tanta's production Trail Mortgage Advice pipeline (April 2026).
// Keyword matching via .includes() means the same mappings also still match the
// older sandbox stage names, so changes to stage names in Trail won't break
// the dashboard unless the new name contains NONE of the tracked keywords.
//
// Fallback `return s` means any unrecognised stage shows its raw name but won't
// count toward Opportunity/Submitted/PreApproval/Unconditional/BuildContract/
// Settled/Lost buckets. If a new stage appears with zero counts in the table,
// it's unmapped — add a new .includes() branch below.

// Client grading colour mapping (Trail profileRank — A is top, D is lowest).
// Renders as a small square letter badge next to the client name.
function RankBadge({ rank }: { rank?: string | null }) {
  if (!rank) return null;
  const up = rank.toUpperCase();
  const colour =
    up === 'A' ? 'bg-green-500 text-white' :
    up === 'B' ? 'bg-blue-500 text-white' :
    up === 'C' ? 'bg-amber-500 text-white' :
    up === 'D' ? 'bg-red-500 text-white' :
                 'bg-gray-400 text-white';
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-black ${colour} flex-shrink-0`}
      title={`Client grade: ${up}`}
    >
      {up}
    </span>
  );
}

function displayStage(s: string): string {
  if (!s) return s;
  const n = s.toLowerCase().replace(/\s+/g, ' ').trim();

  // Longer/specific matches FIRST so e.g. "in progress build contract" wins
  // before "build contract not started" would also match, and so "book strategy
  // session" doesn't collide with "strategy session scheduled".
  if (n.includes('in progress build contract'))      return 'Settled';
  if (n.includes('build contract not started'))      return 'BuildContract';
  if (n.includes('loan structure meeting'))          return 'Unconditional';
  if (n.includes('preparing bank approval'))         return 'Opportunity';
  if (n.includes('finalise application'))            return 'Opportunity';
  if (n.includes('ff sent'))                         return 'Opportunity';
  if (n.includes('book strategy session'))           return 'Opportunity';
  if (n.includes('strategy session scheduled'))      return 'Opportunity';
  if (n.includes('live') && n.includes('deal only')) return 'Opportunity';
  if (n.includes('deal submitted'))                  return 'Submitted';
  if (n.includes('waiting for application approval'))return 'Submitted';
  if (n.includes('conditional approval'))            return 'PreApproval';
  if (n.includes('house under contract'))            return 'Unconditional';
  if (n.includes('ready to settle'))                 return 'Unconditional';
  if (n.includes('loan drawn'))                      return 'Settled';
  if (n.includes('loan settled'))                    return 'Settled';
  if (n.includes('commission received'))             return 'Settled';
  return s;
}

// ===== Main Component =====
export default function Dashboard() {
  const [allOpps, setAllOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [dataIsStale, setDataIsStale] = useState(false);
  const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState('');
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(5); // minutes

  // Executive mode — gated by a shared PIN (see EXEC_PIN env var). When true,
  // commission $ / %, estimated commission columns, and YTD commission show.
  // When false (default), staff see pipeline data without any commission info.
  const [execMode, setExecMode] = useState(false);
  const [execModalOpen, setExecModalOpen] = useState(false);
  useEffect(() => {
    // Re-hydrate from localStorage on mount
    if (typeof window !== 'undefined') {
      setExecMode(window.localStorage.getItem('tanta.execMode') === '1');
    }
  }, []);

  // Filters
  const [filterPipeline, setFilterPipeline] = useState('all');
  const [filterAdviser, setFilterAdviser] = useState('all');
  const [filterStatus, setFilterStatus] = useState('Open');

  // View toggle
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');

  // Detail modal
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);

  // Search
  const [searchText, setSearchText] = useState('');

  // Fetch data with client-side cache fallback
  const fetchData = useCallback(async () => {
    setLoading(true);
    const all: Opportunity[] = [];
    let page = 1;
    try {
      while (true) {
        const res = await fetch(`/api/opportunities?page=${page}&pageSize=500`);
        const data = await res.json();
        if (data.error) throw new Error(data.error + (data.detail ? ': ' + data.detail : ''));
        if (!data.records || data.records.length === 0) break;
        all.push(...data.records);
        if (all.length >= (data.totalRecords || Infinity)) break;
        page++;
      }
      // Success — update data and clear stale flag
      setAllOpps(all);
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });
      const dateStr = now.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
      setLastUpdated(`${timeStr}, ${dateStr}`);
      setLastSuccessfulUpdate(`${timeStr}, ${dateStr}`);
      setError('');
      setDataIsStale(false);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to load data';
      setError(errMsg);
      // If we already have data, mark it as stale but keep showing it
      if (allOpps.length > 0) {
        setDataIsStale(true);
      }
    }
    setLoading(false);
  }, [allOpps.length]);

  // Auto-refresh on interval
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, autoRefreshInterval * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData, autoRefreshInterval]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Base universe for the whole dashboard: Mortgage Advice pipeline only,
  // active advisers only (EXCLUDED_ADVISERS list filters out ex-staff whose
  // unassigned deals would otherwise skew the metrics), and non-archived
  // profiles only (archived profiles keep their opportunities with
  // status='Open' in Trail, so they'd otherwise inflate the active pipeline).
  // Everything downstream — dropdowns, headline tiles, tables — operates on
  // this filtered set.
  const baseOpps = useMemo(() => allOpps.filter(o => {
    if (EXCLUDED_ADVISERS.has(o.adviserName || '')) return false;
    if (o.pipelineName !== INCLUDED_PIPELINE) return false;
    if (o.isProfileArchived === true) return false;
    return true;
  }), [allOpps]);

  // Derived data
  const pipelines = useMemo(() => [...new Set(baseOpps.map(o => o.pipelineName).filter(Boolean))].sort(), [baseOpps]);
  const advisers = useMemo(() => [...new Set(baseOpps.map(o => o.adviserName).filter(Boolean))].sort(), [baseOpps]);

  // Only these stages from the displayStage() mapping count toward the main
  // pipeline metrics.
  const MAPPED_BUCKETS = new Set(['Opportunity', 'Submitted', 'PreApproval', 'Unconditional', 'BuildContract', 'Settled', 'Lost']);
  const isMapped = (stageName?: string) => MAPPED_BUCKETS.has(displayStage(stageName ?? ''));

  const filtered = useMemo(() => baseOpps.filter(o => {
    if (filterPipeline !== 'all' && o.pipelineName !== filterPipeline) return false;
    if (filterAdviser !== 'all' && o.adviserName !== filterAdviser) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    if (searchText && !(o.profileName || '').toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  }), [baseOpps, filterPipeline, filterAdviser, filterStatus, searchText]);

  // ===== Computed Metrics =====
  const metrics = useMemo(() => {
    // Restrict to Mortgage-Advice-bucket deals only for headline metrics.
    const mappedFiltered = filtered.filter(o => isMapped(o.stageName));
    const mappedAll = baseOpps.filter(o => isMapped(o.stageName));

    // "Open" for Deals-in-Progress / Active Pipeline $$$: deals actively being
    // worked. Excludes Settled and Lost buckets even when status='Open' — deals
    // in stages like 'Loan Drawn - Awaiting Comms' or 'In Progress Build
    // Contract' are past the broker-active phase (loan already drawn, deal
    // essentially done) and shouldn't inflate the pipeline tally.
    const open = mappedFiltered.filter(o => {
      if (o.status !== 'Open') return false;
      const bucket = displayStage(o.stageName);
      return bucket !== 'Settled' && bucket !== 'Lost';
    });
    const allForPipeline = mappedAll; // Use all mapped deals for YTD calcs regardless of filter

    // All three "monthly" tiles are strictly this-calendar-year AND this-calendar-month.
    // isThisMonth() already checks both month AND year, so no prior-year data can leak in.
    // No more OR-fallbacks onto expectedSettlementDate or status=Closed that could drag in
    // closed-years-ago deals whose settlement date happens to land this month.

    // Monthly settlements — deal currently in Settled bucket, closed this month
    const monthlySettled = allForPipeline.filter(o =>
      displayStage(o.stageName) === 'Settled' &&
      isThisMonth(o.closedDate || o.modifiedTimestamp)
    );
    const monthlySettledValue = monthlySettled.reduce((s, o) => s + numVal(o.value), 0);

    // Monthly submissions — deal currently in Submitted bucket, modified this month
    const monthlySubmitted = allForPipeline.filter(o =>
      displayStage(o.stageName) === 'Submitted' &&
      isThisMonth(o.modifiedTimestamp || o.createdTimestamp)
    );
    const monthlySubmittedValue = monthlySubmitted.reduce((s, o) => s + numVal(o.value), 0);

    // Monthly new deals — any mapped deal created this month
    const monthlyNew = allForPipeline.filter(o => isThisMonth(o.createdTimestamp));
    const monthlyNewValue = monthlyNew.reduce((s, o) => s + numVal(o.value), 0);

    // YTD figures — same tightening, drop the OR-status=Closed fallback
    const ytdSettled = allForPipeline.filter(o =>
      displayStage(o.stageName) === 'Settled' &&
      isThisYear(o.closedDate || o.modifiedTimestamp)
    );
    const ytdSettledValue = ytdSettled.reduce((s, o) => s + numVal(o.value), 0);
    const ytdSubmitted = allForPipeline.filter(o =>
      displayStage(o.stageName) === 'Submitted' &&
      isThisYear(o.modifiedTimestamp || o.createdTimestamp)
    );
    const ytdSubmittedValue = ytdSubmitted.reduce((s, o) => s + numVal(o.value), 0);
    const ytdNew = allForPipeline.filter(o => isThisYear(o.createdTimestamp));
    const ytdNewValue = ytdNew.reduce((s, o) => s + numVal(o.value), 0);

    // Pipeline breakdown by stage (only mapped deals).
    // The 'Settled' bucket is scoped to this calendar year only — Tanta has years
    // of historical closed deals and Chris only wants the current-year number here.
    const stageBreakdown: Record<string, { count: number; value: number }> = {};
    mappedFiltered.forEach(o => {
      const stage = displayStage(o.stageName);
      if (stage === 'Settled' && !isThisYear(o.closedDate || o.modifiedTimestamp)) return;
      if (!stageBreakdown[stage]) stageBreakdown[stage] = { count: 0, value: 0 };
      stageBreakdown[stage].count++;
      stageBreakdown[stage].value += numVal(o.value);
    });

    // Lost row special: include both Lost and Archived opportunities from this
    // calendar year, regardless of the Active Deals status filter. Trail treats
    // Archived as a separate status (soft-deleted / parked) but from a pipeline
    // standpoint a deal that went archived is effectively lost — we want it
    // visible in the Lost row even when the user is viewing "Active Deals".
    //
    // Still respects pipeline / adviser / search filters so a per-adviser view
    // shows only that adviser's lost+archived deals.
    const lostPool = baseOpps.filter(o => {
      if (filterPipeline !== 'all' && o.pipelineName !== filterPipeline) return false;
      if (filterAdviser !== 'all' && o.adviserName !== filterAdviser) return false;
      if (searchText && !(o.profileName || '').toLowerCase().includes(searchText.toLowerCase())) return false;
      if (o.status !== 'Lost' && o.status !== 'Archived') return false;
      return isThisYear(o.closedDate || o.modifiedTimestamp);
    });
    if (lostPool.length > 0) {
      stageBreakdown['Lost'] = {
        count: lostPool.length,
        value: lostPool.reduce((s, o) => s + numVal(o.value), 0),
      };
    }

    // Active pipeline (open, mapped deals)
    const activePipelineValue = open.reduce((s, o) => s + numVal(o.value), 0);
    const inProgress = open.length;
    const completed = mappedFiltered.filter(o => o.status === 'Closed' || o.status === 'Lost' || o.status === 'Archived').length;

    // Upcoming settlements — only deals whose expected settlement is today or in
    // the future. Past-dated ones are almost always data leftovers (deal settled
    // but not yet moved into the Settled stage) and they were dominating the list
    // because the old daysUntil() clamped past dates to 0.
    const now = Date.now();
    const upcoming = open
      .filter(o => {
        const d = o.mortgageApplication?.expectedSettlementDate;
        if (!d) return false;
        return new Date(d).getTime() >= now - 86400000; // allow anything from yesterday onwards
      })
      .map(o => ({
        ...o,
        daysAway: daysUntil(o.mortgageApplication?.expectedSettlementDate),
      }))
      .sort((a, b) => a.daysAway - b.daysAway)
      .slice(0, 6);
    const pendingSettlementValue = upcoming.reduce((s, o) => s + numVal(o.value), 0);

    // Conversion rates (scoped to mapped-bucket deals only)
    const totalLeads = allForPipeline.length;
    const totalSubmissions = allForPipeline.filter(o => {
      const b = displayStage(o.stageName);
      return b === 'Submitted' || b === 'PreApproval' || b === 'Unconditional' || b === 'Settled' || o.status === 'Closed';
    }).length;
    const totalSettled = allForPipeline.filter(o =>
      displayStage(o.stageName) === 'Settled' || o.status === 'Closed'
    ).length;
    const totalLost = allForPipeline.filter(o => o.status === 'Lost').length;

    // Average commission and mortgage size (using lender-specific rates)
    const avgMortgageSize = open.length > 0 ? activePipelineValue / open.length : 0;
    const totalCommissionPipeline = open.reduce((s, o) => s + getCommission(o), 0);
    const avgCommission = open.length > 0 ? totalCommissionPipeline / open.length : 0;
    const ytdCommission = ytdSettled.reduce((s, o) => s + getCommission(o), 0);
    const pendingCommission = upcoming.reduce((s, o) => s + getCommission(o), 0);

    // Deal ageing
    // Deal Ageing — CUMULATIVE days in the current stage across all past
    // visits to that stage (so a deal that moved A → B → back to A keeps
    // counting its original A time). Populated by the office-side trail-sync
    // into the opportunity_stage_history table; exposed via the API as
    // daysInCurrentStage. Falls back to daysSince(createdTimestamp) if no
    // tracking data yet (new deals between syncs).
    const ageByStage: Record<string, number[]> = {};
    open.forEach(o => {
      const stage = displayStage(o.stageName);
      const tracked = (o as any).daysInCurrentStage;
      const age = typeof tracked === 'number' ? Math.floor(tracked) : daysSince(o.createdTimestamp);
      if (!ageByStage[stage]) ageByStage[stage] = [];
      ageByStage[stage].push(age);
    });

    // Source breakdown
    const sources: Record<string, number> = {};
    allForPipeline.forEach(o => {
      const src = o.source || 'Unknown';
      sources[src] = (sources[src] || 0) + 1;
    });
    const topSources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      monthlySettledValue, monthlySettledCount: monthlySettled.length, monthlySettledDeals: monthlySettled,
      monthlySubmittedValue, monthlySubmittedCount: monthlySubmitted.length, monthlySubmittedDeals: monthlySubmitted,
      monthlyNewValue, monthlyNewCount: monthlyNew.length, monthlyNewDeals: monthlyNew,
      ytdSettledValue, ytdSubmittedValue, ytdNewValue, ytdCommission,
      stageBreakdown, activePipelineValue, inProgress, completed,
      upcoming, pendingSettlementValue,
      leadToSub: pctNum(totalSubmissions, totalLeads),
      subToSettle: pctNum(totalSettled, totalSubmissions),
      leadToSettle: pctNum(totalSettled, totalLeads),
      pctLost: pctNum(totalLost, totalLeads),
      avgCommission, avgMortgageSize, pendingCommission, totalCommissionPipeline,
      topSources, totalLeads,
      ageByStage,
    };
  }, [filtered, allOpps]);

  // Drilldown modal state — clicking a stat tile shows the underlying deals.
  const [drilldown, setDrilldown] = useState<{ title: string; subtitle: string; deals: Opportunity[] } | null>(null);

  // ===== Render =====
  if (loading && allOpps.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-surface-container-high border-t-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-on-surface-variant">Loading pipeline data from Trail...</p>
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
          <a className="flex items-center gap-3 px-4 py-3 bg-white text-[#228EBF] font-bold rounded-l-full shadow-sm" href="#">
            <span className="material-symbols-outlined">account_tree</span>
            <span className="text-sm">Pipeline</span>
          </a>
          {[
            { icon: 'description', label: 'Applications', href: '#' },
            { icon: 'folder_shared', label: 'Client Vault', href: '#' },
            { icon: 'account_balance', label: 'Lenders', href: '/lenders' },
            { icon: 'analytics', label: 'Reports', href: '#' },
          ].map(item => (
            <a key={item.label} className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] hover:bg-white/40 transition-all duration-200" href={item.href}>
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="px-4 mt-auto space-y-4">
          <button className="w-full py-3 px-4 bg-gradient-to-br from-primary to-primary-container text-white rounded-xl font-semibold text-sm shadow-md flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-sm">add</span>
            New Application
          </button>
          <a className="flex items-center gap-3 px-4 py-3 text-[#3f484f] hover:text-[#228EBF] transition-all" href="#">
            <span className="material-symbols-outlined">logout</span>
            <span className="text-sm">Sign Out</span>
          </a>
        </div>
      </aside>

      <main className="ml-64 min-h-screen pb-20">
        {/* Top Bar */}
        <header className="flex justify-between items-center px-8 w-full sticky top-0 z-40 bg-surface-container-low h-16">
          <div className="flex items-center bg-surface-container-highest rounded-full px-4 py-1.5 w-96">
            <span className="material-symbols-outlined text-on-surface-variant text-lg mr-2">search</span>
            <input
              className="bg-transparent border-none focus:ring-0 text-sm w-full placeholder-on-surface-variant"
              placeholder="Search pipeline or clients..."
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-6">
            <div className="flex gap-4">
              <span className="material-symbols-outlined text-on-surface-variant cursor-pointer hover:bg-white/50 p-1.5 rounded-lg transition-colors">notifications</span>
              <span className="material-symbols-outlined text-on-surface-variant cursor-pointer hover:bg-white/50 p-1.5 rounded-lg transition-colors">help</span>
              <span className="material-symbols-outlined text-on-surface-variant cursor-pointer hover:bg-white/50 p-1.5 rounded-lg transition-colors" onClick={fetchData}>settings</span>
            </div>
            <TrailSyncButton />
            <ExecModeButton execMode={execMode} onToggle={() => {
              if (execMode) {
                // Lock back to staff mode
                window.localStorage.removeItem('tanta.execMode');
                setExecMode(false);
              } else {
                // Prompt for PIN
                setExecModalOpen(true);
              }
            }} />
            <div className="flex items-center gap-3 border-l border-outline-variant pl-6">
              <div className="text-right">
                <p className="text-sm font-bold text-on-surface">Tanta</p>
                <p className="text-xs text-on-surface-variant">
                  {loading ? 'Refreshing...' : lastUpdated ? `Updated ${lastUpdated}` : 'Connecting...'}
                </p>
              </div>
              <button onClick={fetchData} disabled={loading} className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm transition-all ${dataIsStale ? 'bg-[#EAB308]' : 'bg-primary'} ${loading ? 'animate-pulse' : ''}`} title="Refresh data">
                <span className="material-symbols-outlined text-lg">refresh</span>
              </button>
            </div>
          </div>
        </header>

        {/* Stale data banner */}
        {dataIsStale && (
          <div className="mx-8 mt-4 p-3 bg-[#FFF3CD] text-[#856404] rounded-xl text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">schedule</span>
              <span>Showing cached data from <strong>{lastSuccessfulUpdate}</strong> — live connection unavailable. Will retry automatically.</span>
            </div>
            <button onClick={fetchData} className="px-3 py-1 bg-[#856404]/10 rounded-lg text-xs font-bold hover:bg-[#856404]/20 transition-colors">
              Retry Now
            </button>
          </div>
        )}

        {/* Error - only show if we have no data at all */}
        {error && allOpps.length === 0 && (
          <div className="mx-8 mt-4 p-4 bg-error-container text-on-error-container rounded-xl text-sm">
            <strong>Connection Error:</strong> {error}
            <p className="text-xs mt-1">Check TRAIL_API_KEY in Vercel environment variables and IP whitelisting in Trail.</p>
            <button onClick={fetchData} className="mt-2 px-4 py-1.5 bg-on-error-container/10 rounded-lg text-xs font-bold hover:bg-on-error-container/20 transition-colors">
              Retry Connection
            </button>
          </div>
        )}

        <div className="p-8 space-y-6">
          {/* TOP ROW: Summary Cards (clickable — opens a drilldown showing which deals make up the number) */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Monthly Settlements $$$', value: fmtBigCurrency(metrics.monthlySettledValue), border: 'border-primary',   deals: metrics.monthlySettledDeals,  subtitle: 'Mapped-bucket = Settled · closed or settlement-dated this month' },
              { label: '# of Settlements',        value: String(metrics.monthlySettledCount),          border: 'border-secondary', deals: metrics.monthlySettledDeals,  subtitle: 'Mapped-bucket = Settled · closed or settlement-dated this month' },
              { label: 'Monthly Submissions $$$', value: fmtBigCurrency(metrics.monthlySubmittedValue),border: 'border-primary',   deals: metrics.monthlySubmittedDeals,subtitle: 'Currently in Submitted bucket · modified this month' },
              { label: '# of Submissions',        value: String(metrics.monthlySubmittedCount),        border: 'border-secondary', deals: metrics.monthlySubmittedDeals,subtitle: 'Currently in Submitted bucket · modified this month' },
              { label: 'Monthly New Deals $$$',   value: fmtBigCurrency(metrics.monthlyNewValue),      border: 'border-primary',   deals: metrics.monthlyNewDeals,      subtitle: 'All mapped deals created this month' },
              { label: '# of New Deals',          value: String(metrics.monthlyNewCount),              border: 'border-secondary', deals: metrics.monthlyNewDeals,      subtitle: 'All mapped deals created this month' },
            ].map((card, i) => (
              <button
                key={i}
                onClick={() => setDrilldown({ title: card.label, subtitle: card.subtitle, deals: card.deals })}
                className={`bg-surface-container-lowest p-5 rounded-xl border-b-2 ${card.border} shadow-md text-left hover:shadow-lg hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1 flex items-center gap-1">
                  {card.label}
                  <span className="material-symbols-outlined text-[12px] opacity-40 group-hover:opacity-100">info</span>
                </p>
                <p className="text-xl font-black text-on-surface">{card.value}</p>
              </button>
            ))}
          </div>

          {/* FILTER BAR */}
          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase ml-1 mb-0.5">Pipeline</label>
                <select value={filterPipeline} onChange={e => setFilterPipeline(e.target.value)}
                  className="text-sm font-semibold border-none bg-surface-container-low rounded-lg py-1 px-3 focus:ring-2 focus:ring-primary/20 text-on-surface cursor-pointer">
                  <option value="all">All Pipelines</option>
                  {pipelines.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="h-8 w-px bg-outline-variant/30 mt-3" />
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase ml-1 mb-0.5">Adviser</label>
                <select value={filterAdviser} onChange={e => setFilterAdviser(e.target.value)}
                  className="text-sm font-semibold border-none bg-surface-container-low rounded-lg py-1 px-3 focus:ring-2 focus:ring-primary/20 text-on-surface cursor-pointer">
                  <option value="all">All Advisers</option>
                  {advisers.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="h-8 w-px bg-outline-variant/30 mt-3" />
              <div className="flex flex-col">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase ml-1 mb-0.5">Status</label>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="text-sm font-semibold border-none bg-surface-container-low rounded-lg py-1 px-3 focus:ring-2 focus:ring-primary/20 text-on-surface cursor-pointer">
                  <option value="Open">Active Deals</option>
                  <option value="all">All Deals</option>
                  <option value="Closed">Settled</option>
                  <option value="Lost">Lost</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-xl">
              <button onClick={() => setViewMode('board')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'board' ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant hover:bg-white/60'}`}>
                <span className="material-symbols-outlined text-[18px]">dashboard</span> Board View
              </button>
              <button onClick={() => setViewMode('list')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'list' ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant hover:bg-white/60'}`}>
                <span className="material-symbols-outlined text-[18px]">format_list_bulleted</span> List View
              </button>
            </div>
          </div>

          {/* SECOND ROW */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Current Pipeline Table */}
            <div className="lg:col-span-4 bg-surface-container-lowest p-6 rounded-xl overflow-hidden shadow-md">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-bold text-on-surface tracking-tight uppercase">Current Pipeline</h3>
                <span className="material-symbols-outlined text-on-surface-variant cursor-pointer">filter_list</span>
              </div>
              <table className="w-full text-sm text-left">
                <thead className="text-[11px] font-bold text-on-surface-variant border-b border-surface-container-high uppercase">
                  <tr>
                    <th className="pb-3 font-semibold">Stage</th>
                    <th className="pb-3 font-semibold text-center">Count</th>
                    <th className="pb-3 font-semibold text-right">Value ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {['Lost', 'Settled', 'Opportunity', 'Submitted', 'PreApproval', 'Unconditional', 'BuildContract'].map(stage => {
                    const data = metrics.stageBreakdown[stage] || { count: 0, value: 0 };
                    const label =
                      stage === 'Settled'       ? 'Settled (YTD)' :
                      stage === 'Lost'          ? 'Lost/Archived (YTD)' :
                      stage === 'BuildContract' ? 'Build Contract' :
                      stage;
                    return (
                      <tr key={stage} className="hover:bg-surface-bright">
                        <td className="py-3 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${STAGE_COLORS[stage] || 'bg-gray-400'}`} />
                          {label}
                        </td>
                        <td className="py-3 text-center">{data.count}</td>
                        <td className="py-3 text-right font-medium">{fmtCurrency(data.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-6 flex justify-between border-t border-surface-container-high pt-4">
                <div className="text-center">
                  <p className="text-[10px] uppercase text-on-surface-variant font-bold">Completed</p>
                  <p className="text-lg font-black text-on-surface">{metrics.completed}</p>
                </div>
                <div className="text-center border-l border-surface-container-high pl-8 pr-8">
                  <p className="text-[10px] uppercase text-on-surface-variant font-bold">In Progress</p>
                  <p className="text-lg font-black text-on-surface">{metrics.inProgress}</p>
                </div>
              </div>
            </div>

            {/* Active Pipeline */}
            <div className="lg:col-span-4 bg-surface-container-lowest p-6 rounded-xl flex flex-col items-center justify-center relative overflow-hidden shadow-md">
              <div className="absolute top-6 left-6 text-left">
                <h3 className="text-sm font-bold text-on-surface tracking-tight uppercase">Active Pipeline</h3>
                <p className="text-3xl font-black text-primary tracking-tighter mt-2">{fmtBigCurrency(metrics.activePipelineValue)}</p>
                <p className="text-xs font-semibold text-on-surface-variant mt-1">{metrics.inProgress} Deals in Progress</p>
              </div>
              {/* Simple pie chart visual */}
              <div className="mt-20 w-full">
                <div className="grid grid-cols-2 gap-3 mt-4">
                  {Object.entries(metrics.stageBreakdown)
                    .filter(([stage]) => !['Lost', 'Settled'].includes(stage))
                    .sort((a, b) => b[1].value - a[1].value)
                    .map(([stage, data]) => (
                      <div key={stage} className="flex items-center gap-2 text-xs font-medium">
                        <span className={`w-3 h-3 rounded-sm ${STAGE_COLORS[stage] || 'bg-gray-400'}`} />
                        {stage} ({pct(data.count, metrics.inProgress)})
                      </div>
                    ))}
                </div>
                {/* Bar chart representation */}
                <div className="mt-4 flex h-4 rounded-full overflow-hidden bg-surface-container-high">
                  {Object.entries(metrics.stageBreakdown)
                    .filter(([stage]) => !['Lost', 'Settled'].includes(stage))
                    .map(([stage, data]) => {
                      const w = metrics.inProgress > 0 ? (data.count / metrics.inProgress) * 100 : 0;
                      const colors: Record<string, string> = {
                        Opportunity: '#EAB308', Submitted: '#2b6486', PreApproval: '#84CC16',
                        Unconditional: '#00658c', BuildContract: '#F97316',
                      };
                      return <div key={stage} style={{ width: `${w}%`, backgroundColor: colors[stage] || '#999' }} />;
                    })}
                </div>
              </div>
            </div>

            {/* Upcoming Settlements */}
            <div className="lg:col-span-4 bg-surface-container-lowest p-6 rounded-xl shadow-md border-t-4 border-primary">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-sm font-bold text-on-surface tracking-tight uppercase">Upcoming Settlements</h3>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase">Total Pending</p>
                  <p className="text-xl font-black text-primary">{fmtCurrency(metrics.pendingSettlementValue)}</p>
                  {execMode && (
                    <p className="text-[10px] font-semibold text-on-surface-variant">Est. comm: {fmtCurrency(metrics.pendingCommission)}</p>
                  )}
                </div>
              </div>
              <table className="w-full text-left">
                <thead className="text-[10px] font-black text-on-surface-variant border-b border-surface-container-high uppercase">
                  <tr>
                    <th className="pb-2">Client</th>
                    <th className="pb-2 text-right">Amount</th>
                    {execMode && <th className="pb-2 text-right">Comm.</th>}
                    <th className="pb-2 text-right">Days</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {metrics.upcoming.map(o => (
                    <tr key={o.opportunityId} className="hover:bg-surface-bright cursor-pointer" onClick={() => setSelectedOpp(o)}>
                      <td className="py-3 font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <RankBadge rank={o.profileRank} />
                          {(o.profileName || '').split(' ').slice(0, 2).join(' ')}
                        </span>
                      </td>
                      <td className="py-3 text-right">{fmtCurrency(numVal(o.value))}</td>
                      {execMode && <td className="py-3 text-right text-primary">{fmtCurrency(getCommission(o))}</td>}
                      <td className={`py-3 text-right font-bold ${o.daysAway <= 7 ? 'text-primary' : 'text-on-surface-variant'}`}>{o.daysAway}d</td>
                    </tr>
                  ))}
                  {metrics.upcoming.length === 0 && (
                    <tr><td colSpan={execMode ? 4 : 3} className="py-4 text-center text-on-surface-variant">No upcoming settlements</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* THIRD ROW */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Conversion Rates */}
            <div className="bg-surface-container-lowest p-6 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-on-surface tracking-tight uppercase mb-6">Conversion Rates</h3>
              <div className="space-y-5">
                {[
                  { label: 'Lead to Sub', value: metrics.leadToSub, color: 'bg-primary' },
                  { label: 'Sub to Settle', value: metrics.subToSettle, color: 'bg-secondary' },
                  { label: 'Lead to Settle', value: metrics.leadToSettle, color: 'bg-surface-tint' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex justify-between text-xs font-bold mb-1.5">
                      <span>{item.label}</span>
                      <span className="text-primary">{item.value}%</span>
                    </div>
                    <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                      <div className={`h-full ${item.color}`} style={{ width: `${Math.min(item.value, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Company Stats */}
            <div className="bg-surface-container-lowest p-6 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-on-surface tracking-tight uppercase mb-6">Company Stats</h3>
              <div className={`grid ${execMode ? 'grid-cols-2' : 'grid-cols-1'} gap-4 mb-6`}>
                {execMode && (
                  <div>
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase">Avg Comm</p>
                    <p className="text-lg font-black text-on-surface">{fmtCurrency(metrics.avgCommission)}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase">Avg Size</p>
                  <p className="text-lg font-black text-on-surface">{fmtCurrency(metrics.avgMortgageSize)}</p>
                </div>
              </div>
              <table className="w-full text-[11px]">
                <tbody className="divide-y divide-surface-container-low">
                  {metrics.topSources.map(([src, count]) => (
                    <tr key={src}><td className="py-2">{src}</td><td className="py-2 text-right font-bold">{count}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Deal Ageing */}
            <div className="bg-surface-container-lowest p-6 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-on-surface tracking-tight uppercase mb-6">Deal Ageing</h3>
              <table className="w-full text-sm text-left">
                <thead className="text-[11px] font-bold text-on-surface-variant border-b border-surface-container-high uppercase">
                  <tr>
                    <th className="pb-3 font-semibold">Stage</th>
                    <th className="pb-3 font-semibold text-center">0-30</th>
                    <th className="pb-3 font-semibold text-center">60+</th>
                    <th className="pb-3 font-semibold text-right">Avg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {['Opportunity', 'PreApproval'].map(stage => {
                    const ages = metrics.ageByStage[stage] || [];
                    const u30 = ages.filter(a => a <= 30).length;
                    const o60 = ages.filter(a => a > 60).length;
                    const avg = ages.length > 0 ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0;
                    return (
                      <tr key={stage} className="hover:bg-surface-bright">
                        <td className="py-2 font-medium">{stage === 'PreApproval' ? 'Pre-App.' : 'Opp.'}</td>
                        <td className="py-2 text-center text-xs">{u30}</td>
                        <td className={`py-2 text-center text-xs ${o60 > 0 ? 'text-error font-bold' : ''}`}>{o60}</td>
                        <td className="py-2 text-right text-xs">{avg}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Client Grading — distribution of open-pipeline deals by profileRank */}
            <div className="bg-surface-container-lowest p-6 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-on-surface tracking-tight uppercase mb-6">Client Grading</h3>
              {(() => {
                const counts: Record<string, number> = {};
                metrics.upcoming.forEach(() => {}); // keep hook stable; iterate real open list below
                const pool = filtered.filter(o => o.status === 'Open');
                pool.forEach(o => {
                  const r = (o.profileRank || '—').toUpperCase();
                  counts[r] = (counts[r] || 0) + 1;
                });
                const total = pool.length;
                const order = ['A', 'B', 'C', 'D', '—'];
                const rows = order.filter(k => counts[k]);
                if (total === 0) return <p className="text-xs text-on-surface-variant">No open deals to grade.</p>;
                return (
                  <div className="space-y-3">
                    {rows.map(k => {
                      const pctV = Math.round((counts[k] / total) * 100);
                      return (
                        <div key={k}>
                          <div className="flex justify-between text-xs font-bold mb-1.5">
                            <span className="flex items-center gap-2">
                              <RankBadge rank={k === '—' ? null : k} />
                              {k === '—' ? 'Ungraded' : `Grade ${k}`}
                            </span>
                            <span className="text-on-surface-variant">{counts[k]} ({pctV}%)</span>
                          </div>
                          <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                            <div
                              className={
                                k === 'A' ? 'bg-green-500 h-full' :
                                k === 'B' ? 'bg-blue-500 h-full' :
                                k === 'C' ? 'bg-amber-500 h-full' :
                                k === 'D' ? 'bg-red-500 h-full' :
                                            'bg-gray-400 h-full'
                              }
                              style={{ width: `${pctV}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-on-surface-variant mt-4 pt-3 border-t border-surface-container-high">
                      Based on {total} open deal{total === 1 ? '' : 's'} in the filtered view. Edit grades in Trail.
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="fixed bottom-0 left-64 right-0 bg-[#004c6a] text-white py-3 px-8 flex items-center justify-between border-t border-white/10 z-50">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary-fixed/70">YTD Performance:</span>
          </div>
          <div className="flex gap-8 overflow-x-auto">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-[10px] uppercase text-white/60">Settlements</span>
              <span className="text-sm font-bold">{fmtBigCurrency(metrics.ytdSettledValue)}</span>
            </div>
            <div className="h-6 w-px bg-white/20" />
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-[10px] uppercase text-white/60">Submissions</span>
              <span className="text-sm font-bold">{fmtBigCurrency(metrics.ytdSubmittedValue)}</span>
            </div>
            <div className="h-6 w-px bg-white/20" />
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-[10px] uppercase text-white/60">New Deals</span>
              <span className="text-sm font-bold">{fmtBigCurrency(metrics.ytdNewValue)}</span>
            </div>
            {execMode && (
              <>
                <div className="h-6 w-px bg-white/20" />
                <div className="flex items-center gap-2 whitespace-nowrap text-secondary-container">
                  <span className="text-[10px] uppercase text-white/60">Commission Est.</span>
                  <span className="text-sm font-bold">{fmtBigCurrency(metrics.ytdCommission)}</span>
                </div>
              </>
            )}
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${dataIsStale ? 'bg-yellow-500/20' : 'bg-white/10'}`}>
            <div className={`w-2 h-2 rounded-full ${dataIsStale ? 'bg-yellow-400' : 'bg-green-400 animate-pulse'}`} />
            <span className="text-[10px] font-bold">{dataIsStale ? 'CACHED' : 'LIVE'}</span>
            {lastSuccessfulUpdate && <span className="text-[9px] text-white/50 ml-1">{lastSuccessfulUpdate}</span>}
          </div>
        </footer>
      </main>

      {/* Stat Drilldown Modal — shown when a headline stat tile is clicked */}
      {drilldown && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center" onClick={() => setDrilldown(null)}>
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-6 border-b border-surface-container-high">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Drilldown</p>
                <h2 className="text-lg font-bold text-on-surface">{drilldown.title}</h2>
                <p className="text-xs text-on-surface-variant mt-1">{drilldown.subtitle}</p>
                <p className="text-[10px] text-on-surface-variant mt-2">
                  {drilldown.deals.length} deal{drilldown.deals.length === 1 ? '' : 's'} · Total ${drilldown.deals.reduce((s, o) => s + numVal(o.value), 0).toLocaleString('en-NZ')}
                </p>
              </div>
              <button onClick={() => setDrilldown(null)} className="text-2xl text-on-surface-variant hover:text-on-surface leading-none px-2">&times;</button>
            </div>

            <div className="overflow-y-auto flex-1">
              {drilldown.deals.length === 0 ? (
                <div className="p-10 text-center text-sm text-on-surface-variant">
                  No deals match this calculation.
                </div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="text-[10px] font-bold text-on-surface-variant uppercase border-b border-surface-container-high bg-surface-container-low sticky top-0">
                    <tr>
                      <th className="py-2 px-6">Client</th>
                      <th className="py-2 px-3">Stage</th>
                      <th className="py-2 px-3">Lender</th>
                      <th className="py-2 px-3 text-right">Value</th>
                      {execMode && <th className="py-2 px-3 text-right">Est. Comm.</th>}
                      <th className="py-2 px-3 text-right">Modified</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {drilldown.deals
                      .slice()
                      .sort((a, b) => numVal(b.value) - numVal(a.value))
                      .map(o => (
                        <tr
                          key={o.opportunityId}
                          className="hover:bg-surface-bright cursor-pointer"
                          onClick={() => { setSelectedOpp(o); setDrilldown(null); }}
                        >
                          <td className="py-2 px-6 font-semibold">
                            <span className="inline-flex items-center gap-1.5">
                              <RankBadge rank={o.profileRank} />
                              {o.profileName || '-'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-xs text-on-surface-variant">{o.stageName}</td>
                          <td className="py-2 px-3 text-xs">{o.mortgageApplication?.lender || '-'}</td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(numVal(o.value))}</td>
                          {execMode && <td className="py-2 px-3 text-right text-primary">{fmtCurrency(getCommission(o))}</td>}
                          <td className="py-2 px-3 text-right text-xs text-on-surface-variant">{fmtDate(o.modifiedTimestamp)}</td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedOpp && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center" onClick={() => setSelectedOpp(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-7 shadow-2xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedOpp(null)} className="float-right text-xl text-on-surface-variant hover:text-on-surface">&times;</button>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <RankBadge rank={selectedOpp.profileRank} />
              {selectedOpp.profileName}
            </h2>
            {[
              { l: 'Status', v: selectedOpp.status },
              { l: 'Pipeline / Stage', v: `${selectedOpp.pipelineName} → ${selectedOpp.stageName}` },
              { l: 'Adviser', v: selectedOpp.adviserName },
              { l: 'Deal Value', v: numVal(selectedOpp.value) ? fmtBigCurrency(numVal(selectedOpp.value)) : '-' },
              ...(execMode && numVal(selectedOpp.value) ? [{ l: 'Est. Commission', v: fmtCurrency(getCommission(selectedOpp)) + ` (${(getCommissionRate(selectedOpp.mortgageApplication?.lender) * 100).toFixed(2)}%)` }] : []),
              { l: 'Lender', v: selectedOpp.mortgageApplication?.lender },
              { l: 'Settlement Date', v: fmtDate(selectedOpp.mortgageApplication?.expectedSettlementDate) },
              { l: 'Pre-Approval Expiry', v: fmtDate(selectedOpp.mortgageApplication?.preApprovalExpiryDate) },
              { l: 'Source', v: selectedOpp.source },
              { l: 'Created', v: fmtDate(selectedOpp.createdTimestamp) },
              { l: 'Last Modified', v: fmtDate(selectedOpp.modifiedTimestamp) },
            ].filter(f => f.v && f.v !== '-').map(f => (
              <div key={f.l} className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">{f.l}</div>
                <div className="text-sm mt-0.5">{f.v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Executive PIN Modal — unlock commission data */}
      {execModalOpen && (
        <ExecPinModal
          onClose={() => setExecModalOpen(false)}
          onSuccess={() => {
            window.localStorage.setItem('tanta.execMode', '1');
            setExecMode(true);
            setExecModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ===== Exec Mode Button =====
// Lock/unlock commission data. Green when unlocked (exec), grey when locked (staff).
function ExecModeButton({ execMode, onToggle }: { execMode: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${
        execMode
          ? 'bg-primary text-white hover:opacity-90'
          : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
      }`}
      title={execMode ? 'Executive view (commission data visible) — click to lock' : 'Staff view — click to unlock exec data with PIN'}
    >
      <span className="material-symbols-outlined text-sm">{execMode ? 'lock_open' : 'lock'}</span>
      {execMode ? 'Exec' : 'Staff'}
    </button>
  );
}

// ===== Exec PIN Modal =====
function ExecPinModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/exec-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (r.ok) {
        onSuccess();
      } else {
        setError('Wrong PIN');
      }
    } catch {
      setError('Network error');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Executive view</h2>
            <p className="text-xs text-on-surface-variant mt-1">Enter PIN to show commission data</p>
          </div>
          <button onClick={onClose} className="text-2xl text-on-surface-variant hover:text-on-surface leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <input
            type="password"
            autoFocus
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="PIN"
            className="w-full px-4 py-3 border border-surface-container-high rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {error && <p className="text-xs text-error mt-2">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !pin}
            className="mt-4 w-full bg-primary text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? 'Checking...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ===== Trail Sync Button =====
// Shows last-sync age on the pipeline dashboard. Clicking opens a modal with
// the exact command to run on the office PC for a manual sync. No longer queues
// background jobs — Chris removed the 2-min poller that processed them (the
// flashing PowerShell window was annoying). Daily 4pm Task Scheduler sync + this
// manual option covers refresh needs.
function TrailSyncButton() {
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/trail-sync');
      const d = await r.json();
      const latestDone = (d.jobs ?? []).find((j: any) => j.status === 'done');
      if (latestDone?.finished_at) setLastSync(latestDone.finished_at);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 60_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const cmd = 'cd /c/Users/chris/Documents/tanta-pipeline && npm run trail:sync';

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silent */ }
  };

  const ageLabel = (() => {
    if (!lastSync) return 'Never';
    const mins = Math.floor((Date.now() - new Date(lastSync).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  })();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-2 rounded-lg text-xs font-bold text-white flex items-center gap-2 bg-secondary hover:bg-primary transition-colors"
        title={lastSync ? `Last synced ${new Date(lastSync).toLocaleString('en-NZ', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : 'Never synced'}
      >
        <span className="material-symbols-outlined text-sm">sync</span>
        Last sync: {ageLabel}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Sync from Trail — manual</h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  Last synced: <strong>{lastSync ? new Date(lastSync).toLocaleString('en-NZ', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : 'never'}</strong>
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-2xl text-on-surface-variant hover:text-on-surface leading-none">&times;</button>
            </div>

            <p className="text-sm text-on-surface mb-3">
              Paste this into <strong>Git Bash</strong> on your office PC. Takes ~60–90 seconds. Hard-refresh this page after it finishes.
            </p>

            <div className="bg-surface-container-high rounded-lg p-3 font-mono text-xs text-on-surface break-all select-all">
              {cmd}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={onCopy}
                className={`px-3 py-2 rounded-lg text-xs font-bold text-white flex items-center gap-2 transition-colors ${copied ? 'bg-primary' : 'bg-secondary hover:bg-primary'}`}
              >
                <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
                {copied ? 'Copied' : 'Copy command'}
              </button>
            </div>

            <p className="text-[10px] text-on-surface-variant mt-4">
              Your PC also runs a full sync automatically at <strong>4pm NZ every day</strong>. Skip this if you're happy with that cadence.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
