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
  mortgageApplication?: MortgageApplication;
  opportunityType?: string;
  clientInterview?: ClientInterview;
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

// Stage definitions
const PIPELINE_STAGES = ['Opportunity', 'Submitted', 'PreApproval', 'Unconditional'];
const COMPLETED_STAGES = ['Lost', 'Settled'];
const STAGE_COLORS: Record<string, string> = {
  Lost: 'bg-error', Settled: 'bg-primary', Opportunity: 'bg-[#EAB308]',
  Submitted: 'bg-secondary', PreApproval: 'bg-[#84CC16]', Unconditional: 'bg-surface-tint',
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
// Trail suffixes stages with "*Broker" / "*Admin" / "* Close Deal" etc., so we
// match on keywords rather than exact strings. Double-spaces and case variations
// also happen; normalise before matching.
//
// ⚠️ SANDBOX-SPECIFIC: These stage names are from Trail's beta/sandbox environment.
// Our live Trail workspace uses a different set of stage names — when we switch
// TRAIL_BASE_URL to production, revisit this mapping against the live stages
// returned by /api/pipelines. Fallback `return s` means unknown stages just
// show their raw name (safe default), but the stage breakdown table will show
// zero counts until this mapping is updated.
function displayStage(s: string): string {
  if (!s) return s;
  const n = s.toLowerCase().replace(/\s+/g, ' ').trim();

  // Longer/specific matches first so "Book Strategy Session" doesn't collide
  // with a future "Strategy Session Scheduled" check.
  if (n.includes('loan structure meeting'))          return 'Unconditional';
  if (n.includes('preparing bank approval'))         return 'Opportunity';
  if (n.includes('book strategy session'))           return 'Opportunity';
  if (n.includes('strategy session scheduled'))      return 'Opportunity';
  if (n.includes('live') && n.includes('deal only')) return 'Opportunity';
  if (n.includes('deal submitted'))                  return 'Submitted';
  if (n.includes('waiting for application approval'))return 'Submitted';
  if (n.includes('conditional approval'))            return 'PreApproval';
  if (n.includes('house under contract'))            return 'Unconditional';
  if (n.includes('ready to settle'))                 return 'Unconditional';
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

  // Derived data
  const pipelines = useMemo(() => [...new Set(allOpps.map(o => o.pipelineName).filter(Boolean))].sort(), [allOpps]);
  const advisers = useMemo(() => [...new Set(allOpps.map(o => o.adviserName).filter(Boolean))].sort(), [allOpps]);

  const filtered = useMemo(() => allOpps.filter(o => {
    if (filterPipeline !== 'all' && o.pipelineName !== filterPipeline) return false;
    if (filterAdviser !== 'all' && o.adviserName !== filterAdviser) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    if (searchText && !(o.profileName || '').toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  }), [allOpps, filterPipeline, filterAdviser, filterStatus, searchText]);

  // ===== Computed Metrics =====
  const metrics = useMemo(() => {
    const open = filtered.filter(o => o.status === 'Open');
    const allForPipeline = allOpps; // Use all for YTD calcs regardless of filter

    // Monthly figures - settlements
    const monthlySettled = allForPipeline.filter(o =>
      (o.stageName === 'Loan Settled' || o.stageName === 'Commission Received' || o.status === 'Closed') &&
      (isThisMonth(o.closedDate) || isThisMonth(o.mortgageApplication?.expectedSettlementDate))
    );
    const monthlySettledValue = monthlySettled.reduce((s, o) => s + numVal(o.value), 0);

    // Monthly submissions
    const monthlySubmitted = allForPipeline.filter(o =>
      o.stageName === 'Deal Submitted' && isThisMonth(o.modifiedTimestamp || o.createdTimestamp)
    );
    const monthlySubmittedValue = monthlySubmitted.reduce((s, o) => s + numVal(o.value), 0);

    // Monthly new deals
    const monthlyNew = allForPipeline.filter(o => isThisMonth(o.createdTimestamp));
    const monthlyNewValue = monthlyNew.reduce((s, o) => s + numVal(o.value), 0);

    // YTD figures
    const ytdSettled = allForPipeline.filter(o =>
      (o.stageName === 'Loan Settled' || o.status === 'Closed') && isThisYear(o.closedDate)
    );
    const ytdSettledValue = ytdSettled.reduce((s, o) => s + numVal(o.value), 0);
    const ytdSubmitted = allForPipeline.filter(o =>
      o.stageName === 'Deal Submitted' && isThisYear(o.createdTimestamp)
    );
    const ytdSubmittedValue = ytdSubmitted.reduce((s, o) => s + numVal(o.value), 0);
    const ytdNew = allForPipeline.filter(o => isThisYear(o.createdTimestamp));
    const ytdNewValue = ytdNew.reduce((s, o) => s + numVal(o.value), 0);

    // Pipeline breakdown by stage
    const stageBreakdown: Record<string, { count: number; value: number }> = {};
    filtered.forEach(o => {
      const stage = displayStage(o.stageName);
      if (!stageBreakdown[stage]) stageBreakdown[stage] = { count: 0, value: 0 };
      stageBreakdown[stage].count++;
      stageBreakdown[stage].value += numVal(o.value);
    });

    // Active pipeline (open deals)
    const activePipelineValue = open.reduce((s, o) => s + numVal(o.value), 0);
    const inProgress = open.length;
    const completed = filtered.filter(o => o.status === 'Closed' || o.status === 'Lost').length;

    // Upcoming settlements
    const upcoming = open
      .filter(o => o.mortgageApplication?.expectedSettlementDate)
      .map(o => ({
        ...o,
        daysAway: daysUntil(o.mortgageApplication?.expectedSettlementDate),
      }))
      .sort((a, b) => a.daysAway - b.daysAway)
      .slice(0, 6);
    const pendingSettlementValue = upcoming.reduce((s, o) => s + numVal(o.value), 0);

    // Conversion rates (based on all data)
    const totalLeads = allForPipeline.length;
    const totalSubmissions = allForPipeline.filter(o =>
      ['Deal Submitted', 'Conditional Approval', 'House Under Contract', 'Unconditional',
        'Loan Settled', 'Commission Received', 'Submitted', 'PreApproval'].includes(o.stageName) ||
      o.status === 'Closed'
    ).length;
    const totalSettled = allForPipeline.filter(o =>
      o.stageName === 'Loan Settled' || o.stageName === 'Commission Received' || o.status === 'Closed'
    ).length;
    const totalLost = allForPipeline.filter(o => o.status === 'Lost').length;

    // Average commission and mortgage size (using lender-specific rates)
    const avgMortgageSize = open.length > 0 ? activePipelineValue / open.length : 0;
    const totalCommissionPipeline = open.reduce((s, o) => s + getCommission(o), 0);
    const avgCommission = open.length > 0 ? totalCommissionPipeline / open.length : 0;
    const ytdCommission = ytdSettled.reduce((s, o) => s + getCommission(o), 0);
    const pendingCommission = upcoming.reduce((s, o) => s + getCommission(o), 0);

    // Deal ageing
    const ageByStage: Record<string, number[]> = {};
    open.forEach(o => {
      const stage = displayStage(o.stageName);
      const age = daysSince(o.createdTimestamp);
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
      monthlySettledValue, monthlySettledCount: monthlySettled.length,
      monthlySubmittedValue, monthlySubmittedCount: monthlySubmitted.length,
      monthlyNewValue, monthlyNewCount: monthlyNew.length,
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
          {/* TOP ROW: Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Monthly Settlements $$$', value: fmtBigCurrency(metrics.monthlySettledValue), border: 'border-primary' },
              { label: '# of Settlements', value: String(metrics.monthlySettledCount), border: 'border-secondary' },
              { label: 'Monthly Submissions $$$', value: fmtBigCurrency(metrics.monthlySubmittedValue), border: 'border-primary' },
              { label: '# of Submissions', value: String(metrics.monthlySubmittedCount), border: 'border-secondary' },
              { label: 'Monthly New Deals $$$', value: fmtBigCurrency(metrics.monthlyNewValue), border: 'border-primary' },
              { label: '# of New Deals', value: String(metrics.monthlyNewCount), border: 'border-secondary' },
            ].map((card, i) => (
              <div key={i} className={`bg-surface-container-lowest p-5 rounded-xl border-b-2 ${card.border} shadow-md`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">{card.label}</p>
                <p className="text-xl font-black text-on-surface">{card.value}</p>
              </div>
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
                  {['Lost', 'Settled', 'Opportunity', 'Submitted', 'PreApproval', 'Unconditional'].map(stage => {
                    const data = metrics.stageBreakdown[stage] || { count: 0, value: 0 };
                    return (
                      <tr key={stage} className="hover:bg-surface-bright">
                        <td className="py-3 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${STAGE_COLORS[stage] || 'bg-gray-400'}`} />
                          {stage}
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
                        Opportunity: '#EAB308', Submitted: '#2b6486', PreApproval: '#84CC16', Unconditional: '#00658c',
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
                  <p className="text-[10px] font-semibold text-on-surface-variant">Est. comm: {fmtCurrency(metrics.pendingCommission)}</p>
                </div>
              </div>
              <table className="w-full text-left">
                <thead className="text-[10px] font-black text-on-surface-variant border-b border-surface-container-high uppercase">
                  <tr>
                    <th className="pb-2">Client</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2 text-right">Comm.</th>
                    <th className="pb-2 text-right">Days</th>
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {metrics.upcoming.map(o => (
                    <tr key={o.opportunityId} className="hover:bg-surface-bright cursor-pointer" onClick={() => setSelectedOpp(o)}>
                      <td className="py-3 font-semibold">{(o.profileName || '').split(' ').slice(0, 2).join(' ')}</td>
                      <td className="py-3 text-right">{fmtCurrency(numVal(o.value))}</td>
                      <td className="py-3 text-right text-primary">{fmtCurrency(getCommission(o))}</td>
                      <td className={`py-3 text-right font-bold ${o.daysAway <= 7 ? 'text-primary' : 'text-on-surface-variant'}`}>{o.daysAway}d</td>
                    </tr>
                  ))}
                  {metrics.upcoming.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-on-surface-variant">No upcoming settlements</td></tr>
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
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase">Avg Comm</p>
                  <p className="text-lg font-black text-on-surface">{fmtCurrency(metrics.avgCommission)}</p>
                </div>
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

            {/* Client Grading (placeholder - would need additional data) */}
            <div className="bg-surface-container-lowest p-6 rounded-xl shadow-md">
              <h3 className="text-sm font-bold text-on-surface tracking-tight uppercase mb-6">Client Grading</h3>
              <p className="text-xs text-on-surface-variant">Client grading data will be available when Trail adds profile grading to the API. For now, use Trail directly for client grades.</p>
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
            <div className="h-6 w-px bg-white/20" />
            <div className="flex items-center gap-2 whitespace-nowrap text-secondary-container">
              <span className="text-[10px] uppercase text-white/60">Commission Est.</span>
              <span className="text-sm font-bold">{fmtBigCurrency(metrics.ytdCommission)}</span>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${dataIsStale ? 'bg-yellow-500/20' : 'bg-white/10'}`}>
            <div className={`w-2 h-2 rounded-full ${dataIsStale ? 'bg-yellow-400' : 'bg-green-400 animate-pulse'}`} />
            <span className="text-[10px] font-bold">{dataIsStale ? 'CACHED' : 'LIVE'}</span>
            {lastSuccessfulUpdate && <span className="text-[9px] text-white/50 ml-1">{lastSuccessfulUpdate}</span>}
          </div>
        </footer>
      </main>

      {/* Detail Modal */}
      {selectedOpp && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center" onClick={() => setSelectedOpp(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-7 shadow-2xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedOpp(null)} className="float-right text-xl text-on-surface-variant hover:text-on-surface">&times;</button>
            <h2 className="text-lg font-bold mb-4">{selectedOpp.profileName}</h2>
            {[
              { l: 'Status', v: selectedOpp.status },
              { l: 'Pipeline / Stage', v: `${selectedOpp.pipelineName} → ${selectedOpp.stageName}` },
              { l: 'Adviser', v: selectedOpp.adviserName },
              { l: 'Deal Value', v: numVal(selectedOpp.value) ? fmtBigCurrency(numVal(selectedOpp.value)) : '-' },
              { l: 'Est. Commission', v: numVal(selectedOpp.value) ? fmtCurrency(getCommission(selectedOpp)) + ` (${(getCommissionRate(selectedOpp.mortgageApplication?.lender) * 100).toFixed(2)}%)` : '-' },
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
    </div>
  );
}

// ===== Trail Sync Button =====
function TrailSyncButton() {
  const [status, setStatus] = useState<'idle' | 'queued' | 'running' | 'success' | 'error'>('idle');
  const [lastSync, setLastSync] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/trail-sync');
      const d = await r.json();
      const latest = (d.jobs ?? [])[0];
      if (!latest) return;
      if (latest.status === 'pending') setStatus('queued');
      else if (latest.status === 'running') setStatus('running');
      else if (latest.status === 'failed') setStatus('error');
      else if (latest.status === 'done') {
        setStatus('idle');
        if (latest.finished_at) setLastSync(latest.finished_at);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 30_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const onClick = async () => {
    setStatus('queued');
    try {
      const r = await fetch('/api/trail-sync', { method: 'POST' });
      if (!r.ok) throw new Error('Queue failed');
      // Start polling more aggressively for ~3 minutes so the UI updates when the office PC picks it up.
      let ticks = 0;
      const t = setInterval(async () => {
        ticks++;
        await fetchStatus();
        if (ticks > 36) clearInterval(t); // 36 * 5s = 3min
      }, 5_000);
    } catch (err) {
      setStatus('error');
    }
  };

  const label =
    status === 'queued'  ? 'Queued...' :
    status === 'running' ? 'Syncing from office PC...' :
    status === 'error'   ? 'Sync failed — click to retry' :
    'Sync from Trail';

  const color =
    status === 'queued' || status === 'running' ? 'bg-[#EAB308]' :
    status === 'error'                          ? 'bg-error' :
                                                  'bg-secondary';

  const tooltip = lastSync ? `Last synced ${new Date(lastSync).toLocaleString('en-NZ', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : 'Not yet synced';

  return (
    <button
      onClick={onClick}
      disabled={status === 'queued' || status === 'running'}
      className={`px-3 py-2 rounded-lg text-xs font-bold text-white flex items-center gap-2 ${color} disabled:opacity-75 transition-colors`}
      title={tooltip}
    >
      <span className={`material-symbols-outlined text-sm ${status === 'running' || status === 'queued' ? 'animate-spin' : ''}`}>sync</span>
      {label}
    </button>
  );
}
