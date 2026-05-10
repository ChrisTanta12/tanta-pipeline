/**
 * Shared types for the /api/sales endpoints + /sales dashboard + sales-manager
 * skill. Kept lean: only the shapes consumed by API responses live here.
 */
import type { PipelineBucket } from './stages';

/** Per-source breakdown used by /api/sales/leads and /api/sales/source-mix. */
export type LeadSourceCount = {
  source: string;
  count: number;
};

/** Trend bucket — one observation per period in a rolling window. */
export type TrendPoint = {
  periodStart: string;          // ISO date (yyyy-mm-dd)
  periodEnd: string;            // ISO date inclusive
  count: number;
};

export type LeadsResponse = {
  window: 'week' | 'fortnight' | 'month' | 'quarter';
  windowStart: string;
  windowEnd: string;
  total: number;
  bySource: LeadSourceCount[];
  trend: TrendPoint[];          // last 4 periods of the same window length
};

export type FunnelBucket = {
  bucket: PipelineBucket | string;
  count: number;
  value: number;                // sum of `value` field across opps in bucket
};

export type FunnelTransition = {
  from: PipelineBucket;
  to: PipelineBucket;
  fromCount: number;            // opps that ever reached `from` in window
  toCount: number;              // opps that ever reached `to` in window
  conversionPct: number;        // toCount / fromCount * 100, integer
};

export type FunnelResponse = {
  windowDays: number;
  current: FunnelBucket[];      // present-state counts
  transitions: FunnelTransition[];
};

export type StaleLead = {
  opportunityId: number;
  profileName: string;
  adviserName: string;
  stageName: string;
  bucket: string;
  daysInStage: number;
  value: number;
};

export type StaleLeadsResponse = {
  thresholdDays: number;
  byBucket: Array<{ bucket: string; count: number; leads: StaleLead[] }>;
  total: number;
};

export type ExpiringPreApproval = {
  opportunityId: number;
  profileName: string;
  adviserName: string;
  expiresAt: string;            // yyyy-mm-dd
  daysUntilExpiry: number;
  lender: string;
};

export type ExpiringPreApprovalsResponse = {
  withinDays: number;
  total: number;
  expirations: ExpiringPreApproval[];
};

export type SourceMixResponse = {
  windowDays: number;
  total: number;
  bySource: LeadSourceCount[];
  topSourcePct: number;
  concentrationCeilingPct: number;
  concentrationFlag: boolean;   // true if top source exceeds ceiling
};

export type LostBucket = {
  stageAtLoss: string;
  count: number;
  totalValue: number;
};

export type LostResponse = {
  windowDays: number;
  total: number;
  byStageAtLoss: LostBucket[];
};

export type KsCrossSellCandidate = {
  profileId: string;
  profileName: string;
  email: string | null;
  mortgageSettledDate: string | null;
  /**
   * Best-guess current KiwiSaver provider, sourced from the per-profile
   * Trail `/kiwisavers?profileId=...` cache. `null` when:
   *   - the cache hasn't been populated yet for this profile, or
   *   - the profile has no KiwiSaver records in Trail.
   */
  currentProvider: string | null;
};

export type KsAttachResponse = {
  windowDays: number;
  settledMortgages: number;
  ksConversions: number;
  attachPct: number;            // ksConversions / settledMortgages * 100, integer
  candidates: KsCrossSellCandidate[];   // settled mortgages NOT in ks_conversions
};

export type SalesTargets = {
  settlementsPerFortnight?: number;
  newLeadsPerWeek?: number;
  ksAttachPct?: number;
  sourceConcentrationCeilingPct?: number;
};

export type TargetsResponse = {
  current: SalesTargets;
  proposed: SalesTargets;       // computed from last-4-fortnight baselines
  updatedBy: string | null;
  updatedAt: string | null;
};

export type ScorecardLine = {
  metric: string;
  actual: number;
  target?: number;
  unit?: '$' | '%' | 'leads' | 'deals' | 'days';
  status: 'on-track' | 'at-risk' | 'off-track' | 'no-target';
};

export type ScorecardResponse = {
  window: 'fortnight' | 'week' | 'month';
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  lines: ScorecardLine[];
  alerts: Array<{ severity: 'info' | 'warn' | 'red'; title: string; detail?: string }>;
};
