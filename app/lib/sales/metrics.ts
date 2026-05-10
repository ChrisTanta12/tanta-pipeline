/**
 * Pure metric functions for the /api/sales/* endpoints.
 *
 * Inputs are plain JS structures (already loaded from Postgres). Each
 * function returns a fully-shaped response payload. No DB or HTTP calls
 * happen here so the same logic can be reused by the weekly-digest
 * script and unit tests without standing up a server.
 */
import {
  ACTIVE_BUCKETS,
  FUNNEL_TRANSITIONS,
  PIPELINE_BUCKETS,
  type PipelineBucket,
  displayStage,
  isCountableOpportunity,
} from './stages';
import type {
  ExpiringPreApprovalsResponse,
  FunnelBucket,
  FunnelResponse,
  FunnelTransition,
  KsAttachResponse,
  KsCrossSellCandidate,
  LeadSourceCount,
  LeadsResponse,
  LostBucket,
  LostResponse,
  SalesTargets,
  ScorecardLine,
  ScorecardResponse,
  SourceMixResponse,
  StaleLead,
  StaleLeadsResponse,
  TrendPoint,
} from './types';

// =============================================================================
// Time helpers
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

export type WindowKind = 'week' | 'fortnight' | 'month' | 'quarter';

export function windowDays(kind: WindowKind): number {
  switch (kind) {
    case 'week':      return 7;
    case 'fortnight': return 14;
    case 'month':     return 30;
    case 'quarter':   return 90;
  }
}

/** Returns [start, end] as ISO yyyy-mm-dd, end inclusive (today). */
export function windowRange(kind: WindowKind, anchor: Date = new Date()): [string, string] {
  const end = new Date(anchor);
  const start = new Date(anchor.getTime() - (windowDays(kind) - 1) * DAY_MS);
  return [iso(start), iso(end)];
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function inRangeMs(ts: number, fromMs: number, toMs: number): boolean {
  return ts >= fromMs && ts <= toMs;
}

// =============================================================================
// Domain shapes (input)
// =============================================================================

/** A row from `trail_entities WHERE kind='opportunity'`, with derived joins. */
export type OpportunityRow = {
  data: {
    opportunityId: number;
    profileId?: number | string;
    profileName?: string;
    adviserName?: string;
    pipelineName?: string;
    stageName?: string;
    stageId?: number;
    value?: number | string;
    source?: string;
    referrer?: string;
    status?: string;
    closedDate?: string | null;
    createdTimestamp?: string;
    modifiedTimestamp?: string;
    isProfileArchived?: boolean;
    mortgageApplication?: {
      lender?: string;
      preApprovalExpiryDate?: string;
      expectedSettlementDate?: string;
    };
  };
  daysInCurrentStage: number | null;
  stageEnteredAt: string | null;
};

/** Stage-history row, scoped to a single opportunity. */
export type StageHistoryRow = {
  opportunityId: number;
  stageId: number;
  stageName: string | null;
  enteredAt: string;
  leftAt: string | null;
};

/** Brevo contact cache row. */
export type BrevoContactRow = {
  email: string;
  brevoId: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  attributes: Record<string, unknown>;
  listIds: number[];
};

export type KsConversionRow = {
  profileId: string;
  name: string | null;
  email: string | null;
  mortgageSettled: string | null;
  ksSigned: string;
};

/**
 * Trail's `/kiwisavers?profileId={id}` returns an array of KS records
 * per profile. The exact shape isn't documented; extractKsProvider()
 * below tries a handful of likely field names so we work whether the
 * provider is at the top level, nested under a `provider` object, or
 * stored as `schemeName` / `fundName`. Records that don't match any
 * known shape return null and the candidate is shown as "(unknown)"
 * — never an error.
 */
export type TrailKiwiSaverInput = Map<string, { records: any[] }>;

// =============================================================================
// Helpers
// =============================================================================

function num(v: number | string | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function bucketOf(opp: OpportunityRow): string {
  return displayStage(opp.data.stageName);
}

function isActive(opp: OpportunityRow): boolean {
  const status = (opp.data.status || '').toLowerCase();
  if (status === 'lost' || status === 'archived' || status === 'closed') return false;
  const b = bucketOf(opp);
  return b !== 'Lost' && b !== 'Settled';
}

function leadSource(opp: OpportunityRow): string {
  const s = (opp.data.source || opp.data.referrer || '').trim();
  return s || 'Unattributed';
}

function brevoSource(c: BrevoContactRow): string {
  // Prefer an explicit SOURCE attribute, fall back to list membership.
  const attrSource = (c.attributes?.SOURCE as string | undefined)?.trim();
  if (attrSource) return `Brevo: ${attrSource}`;
  if (c.attributes?.QUIZ_TIER) return 'Brevo: KS Quiz';
  if (c.listIds.length > 0) return `Brevo: list ${c.listIds[0]}`;
  return 'Brevo: Unattributed';
}

// =============================================================================
// Leads (new opps + new Brevo contacts in window)
// =============================================================================

/**
 * Counts new leads in the given window. A "lead" is either:
 *   (a) a new Trail Mortgage Advice opportunity created in the window, or
 *   (b) a new Brevo contact created in the window whose email doesn't
 *       already match a Trail opp profile email (rough dedupe).
 *
 * The trend array is the same window shifted back N times (4 periods total
 * including the current window).
 */
export function computeLeads(
  opps: OpportunityRow[],
  brevoContacts: BrevoContactRow[],
  kind: WindowKind,
  anchor: Date = new Date(),
): LeadsResponse {
  const days = windowDays(kind);
  const periods: Array<{ start: number; end: number; iso: [string, string] }> = [];
  for (let i = 3; i >= 0; i--) {
    const periodEnd = new Date(anchor.getTime() - i * days * DAY_MS);
    const periodStart = new Date(periodEnd.getTime() - (days - 1) * DAY_MS);
    periods.push({
      start: periodStart.getTime(),
      end: periodEnd.getTime(),
      iso: [iso(periodStart), iso(periodEnd)],
    });
  }
  const current = periods[periods.length - 1];

  // Current window: source breakdown
  const sourceCounts = new Map<string, number>();
  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    const ts = parseTs(opp.data.createdTimestamp);
    if (ts == null) continue;
    if (!inRangeMs(ts, current.start, current.end)) continue;
    sourceCounts.set(leadSource(opp), (sourceCounts.get(leadSource(opp)) ?? 0) + 1);
  }
  for (const c of brevoContacts) {
    const ts = parseTs(c.createdAt);
    if (ts == null) continue;
    if (!inRangeMs(ts, current.start, current.end)) continue;
    sourceCounts.set(brevoSource(c), (sourceCounts.get(brevoSource(c)) ?? 0) + 1);
  }

  // Trend: leads per period
  const trend: TrendPoint[] = periods.map((p) => {
    let count = 0;
    for (const opp of opps) {
      if (!isCountableOpportunity(opp.data)) continue;
      const ts = parseTs(opp.data.createdTimestamp);
      if (ts != null && inRangeMs(ts, p.start, p.end)) count++;
    }
    for (const c of brevoContacts) {
      const ts = parseTs(c.createdAt);
      if (ts != null && inRangeMs(ts, p.start, p.end)) count++;
    }
    return { periodStart: p.iso[0], periodEnd: p.iso[1], count };
  });

  const bySource: LeadSourceCount[] = Array.from(sourceCounts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
  const total = bySource.reduce((acc, r) => acc + r.count, 0);

  return {
    window: kind,
    windowStart: current.iso[0],
    windowEnd: current.iso[1],
    total,
    bySource,
    trend,
  };
}

// =============================================================================
// Funnel (current bucket distribution + cohort conversion %)
// =============================================================================

export function computeFunnel(
  opps: OpportunityRow[],
  history: StageHistoryRow[],
  windowDaysIn: number = 90,
  anchor: Date = new Date(),
): FunnelResponse {
  const fromMs = anchor.getTime() - windowDaysIn * DAY_MS;
  const toMs = anchor.getTime();

  // Present-state counts
  const counts = new Map<string, FunnelBucket>();
  for (const b of PIPELINE_BUCKETS) {
    counts.set(b, { bucket: b, count: 0, value: 0 });
  }
  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    const b = bucketOf(opp);
    if (!counts.has(b)) counts.set(b, { bucket: b, count: 0, value: 0 });
    const row = counts.get(b)!;
    row.count++;
    row.value += num(opp.data.value);
  }
  const current = PIPELINE_BUCKETS.map((b) => counts.get(b)!);

  // Conversion: for each opp created in window, which buckets did it ever reach?
  const cohortIds = new Set<number>();
  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    const ts = parseTs(opp.data.createdTimestamp);
    if (ts != null && inRangeMs(ts, fromMs, toMs)) cohortIds.add(opp.data.opportunityId);
  }

  // Build per-opp set of buckets ever reached, from history rows (stage_name → bucket).
  const byOpp = new Map<number, Set<string>>();
  for (const h of history) {
    if (!cohortIds.has(h.opportunityId)) continue;
    const b = displayStage(h.stageName);
    if (!byOpp.has(h.opportunityId)) byOpp.set(h.opportunityId, new Set());
    byOpp.get(h.opportunityId)!.add(b);
  }

  const reachedCount = new Map<string, number>();
  for (const reached of byOpp.values()) {
    for (const b of reached) {
      reachedCount.set(b, (reachedCount.get(b) ?? 0) + 1);
    }
  }

  const transitions: FunnelTransition[] = FUNNEL_TRANSITIONS.map(([from, to]) => {
    const fromCount = reachedCount.get(from) ?? 0;
    const toCount = reachedCount.get(to) ?? 0;
    const conversionPct = fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0;
    return { from, to, fromCount, toCount, conversionPct };
  });

  return { windowDays: windowDaysIn, current, transitions };
}

// =============================================================================
// Stale leads
// =============================================================================

export function computeStale(
  opps: OpportunityRow[],
  thresholdDays: number = 14,
): StaleLeadsResponse {
  const byBucket = new Map<string, StaleLead[]>();
  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    if (!isActive(opp)) continue;
    const days = opp.daysInCurrentStage ?? 0;
    if (days <= thresholdDays) continue;
    const b = bucketOf(opp);
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b)!.push({
      opportunityId: opp.data.opportunityId,
      profileName: opp.data.profileName ?? '(unknown)',
      adviserName: opp.data.adviserName ?? '',
      stageName: opp.data.stageName ?? '',
      bucket: b,
      daysInStage: Math.round(days),
      value: num(opp.data.value),
    });
  }
  const out: StaleLeadsResponse['byBucket'] = ACTIVE_BUCKETS
    .filter((b) => byBucket.has(b))
    .map((b) => {
      const leads = byBucket.get(b)!.sort((a, z) => z.daysInStage - a.daysInStage);
      return { bucket: b, count: leads.length, leads };
    });
  // Append any non-canonical buckets that had stale entries (defensive).
  for (const [b, leads] of byBucket) {
    if (ACTIVE_BUCKETS.includes(b as PipelineBucket)) continue;
    out.push({ bucket: b, count: leads.length, leads: leads.sort((a, z) => z.daysInStage - a.daysInStage) });
  }
  const total = out.reduce((acc, r) => acc + r.count, 0);
  return { thresholdDays, byBucket: out, total };
}

// =============================================================================
// Pre-approval expiries
// =============================================================================

export function computeExpiringPreApprovals(
  opps: OpportunityRow[],
  withinDays: number = 30,
  anchor: Date = new Date(),
): ExpiringPreApprovalsResponse {
  const today = anchor.getTime();
  const horizon = today + withinDays * DAY_MS;
  const out: ExpiringPreApprovalsResponse['expirations'] = [];
  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    if (!isActive(opp)) continue;
    const expStr = opp.data.mortgageApplication?.preApprovalExpiryDate;
    if (!expStr) continue;
    const expTs = parseTs(expStr);
    if (expTs == null) continue;
    if (expTs < today || expTs > horizon) continue;
    out.push({
      opportunityId: opp.data.opportunityId,
      profileName: opp.data.profileName ?? '(unknown)',
      adviserName: opp.data.adviserName ?? '',
      expiresAt: expStr.slice(0, 10),
      daysUntilExpiry: Math.max(0, Math.ceil((expTs - today) / DAY_MS)),
      lender: opp.data.mortgageApplication?.lender ?? '',
    });
  }
  out.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  return { withinDays, total: out.length, expirations: out };
}

// =============================================================================
// Source mix + concentration flag
// =============================================================================

export function computeSourceMix(
  opps: OpportunityRow[],
  brevoContacts: BrevoContactRow[],
  windowDaysIn: number = 90,
  ceilingPct: number = 70,
  anchor: Date = new Date(),
): SourceMixResponse {
  const fromMs = anchor.getTime() - windowDaysIn * DAY_MS;
  const toMs = anchor.getTime();
  const counts = new Map<string, number>();
  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    const ts = parseTs(opp.data.createdTimestamp);
    if (ts == null || !inRangeMs(ts, fromMs, toMs)) continue;
    counts.set(leadSource(opp), (counts.get(leadSource(opp)) ?? 0) + 1);
  }
  for (const c of brevoContacts) {
    const ts = parseTs(c.createdAt);
    if (ts == null || !inRangeMs(ts, fromMs, toMs)) continue;
    counts.set(brevoSource(c), (counts.get(brevoSource(c)) ?? 0) + 1);
  }
  const bySource: LeadSourceCount[] = Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
  const total = bySource.reduce((acc, r) => acc + r.count, 0);
  const topSourcePct = total > 0 ? Math.round((bySource[0]?.count ?? 0) / total * 100) : 0;
  return {
    windowDays: windowDaysIn,
    total,
    bySource,
    topSourcePct,
    concentrationCeilingPct: ceilingPct,
    concentrationFlag: topSourcePct > ceilingPct,
  };
}

// =============================================================================
// Lost-deal grouping
// =============================================================================

/**
 * Groups Lost opps in window by the stage they were in immediately before
 * the move to a Lost stage. Falls back to the opp's last non-Lost stage
 * from history if Lost has been entered multiple times.
 */
export function computeLost(
  opps: OpportunityRow[],
  history: StageHistoryRow[],
  windowDaysIn: number = 90,
  anchor: Date = new Date(),
): LostResponse {
  const fromMs = anchor.getTime() - windowDaysIn * DAY_MS;
  const toMs = anchor.getTime();
  const histByOpp = new Map<number, StageHistoryRow[]>();
  for (const h of history) {
    if (!histByOpp.has(h.opportunityId)) histByOpp.set(h.opportunityId, []);
    histByOpp.get(h.opportunityId)!.push(h);
  }
  const buckets = new Map<string, LostBucket>();

  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    const b = bucketOf(opp);
    if (b !== 'Lost' && (opp.data.status || '').toLowerCase() !== 'lost') continue;
    // Use closedDate or modifiedTimestamp to gate the window.
    const refTs = parseTs(opp.data.closedDate || null) ?? parseTs(opp.data.modifiedTimestamp);
    if (refTs == null || !inRangeMs(refTs, fromMs, toMs)) continue;

    // Find the last stage before Lost from history.
    const rows = (histByOpp.get(opp.data.opportunityId) ?? [])
      .slice()
      .sort((a, z) => Date.parse(a.enteredAt) - Date.parse(z.enteredAt));
    let stageAtLoss = 'Unknown';
    for (let i = rows.length - 1; i >= 0; i--) {
      const stageBucket = displayStage(rows[i].stageName);
      if (stageBucket !== 'Lost' && stageBucket !== '') {
        stageAtLoss = stageBucket;
        break;
      }
    }
    if (!buckets.has(stageAtLoss)) buckets.set(stageAtLoss, { stageAtLoss, count: 0, totalValue: 0 });
    const row = buckets.get(stageAtLoss)!;
    row.count++;
    row.totalValue += num(opp.data.value);
  }

  const ordered = ACTIVE_BUCKETS
    .filter((b) => buckets.has(b))
    .map((b) => buckets.get(b)!);
  for (const [b, row] of buckets) {
    if (ACTIVE_BUCKETS.includes(b as PipelineBucket)) continue;
    ordered.push(row);
  }
  const total = ordered.reduce((acc, r) => acc + r.count, 0);
  return { windowDays: windowDaysIn, total, byStageAtLoss: ordered };
}

// =============================================================================
// Mortgage → KiwiSaver attach rate
// =============================================================================

/**
 * Settled mortgages in window minus those already in ks_conversions =
 * candidate cross-sells. Attach % is conversions / settled mortgages
 * over the same window.
 */
export function computeKsAttach(
  opps: OpportunityRow[],
  ksRows: KsConversionRow[],
  windowDaysIn: number = 90,
  anchor: Date = new Date(),
  trailKiwisavers: TrailKiwiSaverInput = new Map(),
): KsAttachResponse {
  const fromMs = anchor.getTime() - windowDaysIn * DAY_MS;
  const toMs = anchor.getTime();
  const ksByProfile = new Map<string, KsConversionRow>();
  for (const r of ksRows) ksByProfile.set(String(r.profileId), r);

  const candidates: KsCrossSellCandidate[] = [];
  let settledMortgages = 0;
  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    if (bucketOf(opp) !== 'Settled') continue;
    const settledStr =
      opp.data.mortgageApplication?.expectedSettlementDate ||
      opp.data.closedDate ||
      opp.data.modifiedTimestamp;
    const settledTs = parseTs(settledStr);
    if (settledTs == null || !inRangeMs(settledTs, fromMs, toMs)) continue;
    settledMortgages++;
    const pid = String(opp.data.profileId ?? '');
    if (!pid) continue;
    if (!ksByProfile.has(pid)) {
      const ksCache = trailKiwisavers.get(pid);
      candidates.push({
        profileId: pid,
        profileName: opp.data.profileName ?? '(unknown)',
        email: null,
        mortgageSettledDate: settledStr ? settledStr.slice(0, 10) : null,
        currentProvider: ksCache ? extractKsProvider(ksCache.records) : null,
      });
    }
  }
  // Count conversions whose ks_signed falls in the same window — that's
  // what "attach rate over last N days" actually measures (you sold a KS
  // product to someone in the period, regardless of when their mortgage
  // settled).
  let ksConversions = 0;
  for (const r of ksRows) {
    const ts = parseTs(r.ksSigned);
    if (ts != null && inRangeMs(ts, fromMs, toMs)) ksConversions++;
  }

  const attachPct =
    settledMortgages > 0 ? Math.round((ksConversions / settledMortgages) * 100) : 0;

  candidates.sort((a, b) => (b.mortgageSettledDate ?? '').localeCompare(a.mortgageSettledDate ?? ''));
  return {
    windowDays: windowDaysIn,
    settledMortgages,
    ksConversions,
    attachPct,
    candidates,
  };
}

// =============================================================================
// Target proposing
// =============================================================================

/**
 * Proposes targets from the last 4 fortnights of history. Settlements
 * and new leads use the median over the window so a single huge fortnight
 * doesn't anchor the target unrealistically high. KS attach % uses the
 * mean over the last 90 days. Source-concentration ceiling defaults to 70.
 */
export function proposeTargets(
  opps: OpportunityRow[],
  brevoContacts: BrevoContactRow[],
  ksRows: KsConversionRow[],
  anchor: Date = new Date(),
): SalesTargets {
  const fortnights: number[] = [];
  for (let i = 0; i < 4; i++) {
    const end = anchor.getTime() - i * 14 * DAY_MS;
    const start = end - 14 * DAY_MS;
    let count = 0;
    for (const opp of opps) {
      if (!isCountableOpportunity(opp.data)) continue;
      if (bucketOf(opp) !== 'Settled') continue;
      const settledStr =
        opp.data.mortgageApplication?.expectedSettlementDate ||
        opp.data.closedDate ||
        opp.data.modifiedTimestamp;
      const ts = parseTs(settledStr);
      if (ts != null && ts >= start && ts <= end) count++;
    }
    fortnights.push(count);
  }
  const settlementsTarget = Math.max(1, median(fortnights));

  const weeklyLeads: number[] = [];
  for (let i = 0; i < 8; i++) {
    const end = anchor.getTime() - i * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;
    let count = 0;
    for (const opp of opps) {
      if (!isCountableOpportunity(opp.data)) continue;
      const ts = parseTs(opp.data.createdTimestamp);
      if (ts != null && ts >= start && ts <= end) count++;
    }
    for (const c of brevoContacts) {
      const ts = parseTs(c.createdAt);
      if (ts != null && ts >= start && ts <= end) count++;
    }
    weeklyLeads.push(count);
  }
  const newLeadsTarget = Math.max(1, median(weeklyLeads));

  const attach = computeKsAttach(opps, ksRows, 90, anchor);
  const ksTarget = Math.max(10, attach.attachPct);

  return {
    settlementsPerFortnight: settlementsTarget,
    newLeadsPerWeek: newLeadsTarget,
    ksAttachPct: ksTarget,
    sourceConcentrationCeilingPct: 70,
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Best-effort extract of "current KiwiSaver provider" from Trail's
 * `/kiwisavers?profileId=...` response. The shape isn't documented,
 * so we try several common field names and prefer the most recently
 * modified record when the profile holds multiple. Returns null when
 * no usable signal is found — caller should render this as "(unknown)".
 *
 * If/when we see real responses and can lock down a single field path,
 * this can be tightened. Until then, defensive parsing is the safest
 * way to ship.
 */
export function extractKsProvider(records: unknown): string | null {
  if (!Array.isArray(records) || records.length === 0) return null;
  // Sort by any timestamp-shaped field, descending. Falls back to original order.
  const sorted = records.slice().sort((a, b) => tsKey(b) - tsKey(a));
  for (const r of sorted) {
    const v = pickProvider(r);
    if (v) return v;
  }
  return null;
}

function tsKey(r: any): number {
  for (const k of ['modifiedTimestamp', 'updatedAt', 'createdTimestamp', 'createdAt', 'startDate']) {
    const v = r?.[k];
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return 0;
}

function pickProvider(r: any): string | null {
  if (!r || typeof r !== 'object') return null;
  // Direct top-level fields — try the most common naming patterns.
  const candidateKeys = [
    'currentProvider', 'provider', 'providerName', 'providerCompany',
    'schemeProvider', 'schemeName', 'scheme', 'fundName', 'fund',
    'kiwiSaverProvider', 'kiwisaverProvider',
  ];
  for (const k of candidateKeys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    // Nested object case e.g. provider.name
    if (v && typeof v === 'object') {
      for (const sub of ['name', 'displayName', 'label', 'company', 'companyName']) {
        const vs = (v as any)[sub];
        if (typeof vs === 'string' && vs.trim().length > 0) return vs.trim();
      }
    }
  }
  return null;
}

// =============================================================================
// Scorecard (single object roll-up used by skill + digest)
// =============================================================================

export function computeScorecard(
  opps: OpportunityRow[],
  history: StageHistoryRow[],
  brevoContacts: BrevoContactRow[],
  ksRows: KsConversionRow[],
  targets: SalesTargets,
  anchor: Date = new Date(),
  trailKiwisavers: TrailKiwiSaverInput = new Map(),
): ScorecardResponse {
  const [winStart, winEnd] = windowRange('fortnight', anchor);
  const fortnightLeads = computeLeads(opps, brevoContacts, 'fortnight', anchor);
  const weeklyLeads = computeLeads(opps, brevoContacts, 'week', anchor);
  const stale = computeStale(opps, 14);
  const expiring = computeExpiringPreApprovals(opps, 30, anchor);
  const sourceMix = computeSourceMix(opps, brevoContacts, 90, targets.sourceConcentrationCeilingPct ?? 70, anchor);
  const ksAttach = computeKsAttach(opps, ksRows, 90, anchor, trailKiwisavers);
  const fundsFromMs = anchor.getTime() - 14 * DAY_MS;

  let settlementsThisFortnight = 0;
  for (const opp of opps) {
    if (!isCountableOpportunity(opp.data)) continue;
    if (displayStage(opp.data.stageName) !== 'Settled') continue;
    const settledStr =
      opp.data.mortgageApplication?.expectedSettlementDate ||
      opp.data.closedDate ||
      opp.data.modifiedTimestamp;
    const ts = parseTs(settledStr);
    if (ts != null && ts >= fundsFromMs && ts <= anchor.getTime()) settlementsThisFortnight++;
  }

  const lines: ScorecardLine[] = [
    line('Settlements (fortnight)', settlementsThisFortnight, targets.settlementsPerFortnight, 'deals'),
    line('New leads (week)', weeklyLeads.total, targets.newLeadsPerWeek, 'leads'),
    line('KS attach % (90d)', ksAttach.attachPct, targets.ksAttachPct, '%'),
    line('Stale leads', stale.total, undefined, 'leads', stale.total === 0 ? 'on-track' : stale.total < 5 ? 'at-risk' : 'off-track'),
    line('Pre-approvals expiring (30d)', expiring.total, undefined, 'leads', expiring.total === 0 ? 'on-track' : 'at-risk'),
    line('Top-source concentration', sourceMix.topSourcePct, sourceMix.concentrationCeilingPct, '%', sourceMix.concentrationFlag ? 'off-track' : 'on-track'),
  ];

  const alerts: ScorecardResponse['alerts'] = [];
  if (sourceMix.concentrationFlag) {
    alerts.push({
      severity: 'warn',
      title: `${sourceMix.bySource[0]?.source ?? 'Top source'} = ${sourceMix.topSourcePct}% of leads`,
      detail: `Above the ${sourceMix.concentrationCeilingPct}% ceiling. Diversify inflow.`,
    });
  }
  if (stale.total > 0) {
    alerts.push({
      severity: stale.total >= 5 ? 'red' : 'info',
      title: `${stale.total} stale lead${stale.total === 1 ? '' : 's'}`,
      detail: `Sitting > ${stale.thresholdDays} days in stage.`,
    });
  }
  if (expiring.total > 0) {
    alerts.push({
      severity: 'warn',
      title: `${expiring.total} pre-approval${expiring.total === 1 ? '' : 's'} expiring < 30d`,
      detail: 'Re-engage before they lapse.',
    });
  }
  if (ksAttach.candidates.length > 0) {
    alerts.push({
      severity: 'info',
      title: `${ksAttach.candidates.length} settled mortgage client${ksAttach.candidates.length === 1 ? '' : 's'} without KS`,
      detail: 'Cross-sell candidates — check ks-conversions.md.',
    });
  }

  return {
    window: 'fortnight',
    windowStart: winStart,
    windowEnd: winEnd,
    generatedAt: new Date().toISOString(),
    lines,
    alerts,
  };

  // Also referenced upstream — silence unused if linter complains.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _unused() { void [history, fortnightLeads]; }
}

function line(
  metric: string,
  actual: number,
  target: number | undefined,
  unit: ScorecardLine['unit'],
  forcedStatus?: ScorecardLine['status'],
): ScorecardLine {
  let status: ScorecardLine['status'] = 'no-target';
  if (forcedStatus) {
    status = forcedStatus;
  } else if (target != null) {
    const ratio = target > 0 ? actual / target : 0;
    if (ratio >= 1) status = 'on-track';
    else if (ratio >= 0.7) status = 'at-risk';
    else status = 'off-track';
  }
  return { metric, actual, target, unit, status };
}
