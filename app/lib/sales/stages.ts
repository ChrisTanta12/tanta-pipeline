/**
 * Server-side mirror of displayStage() / EXCLUDED_ADVISERS / INCLUDED_PIPELINE
 * from app/pipeline/page.tsx. Kept as a separate copy because the pipeline
 * page is a client component ('use client') and the sales API routes need
 * the same bucketing server-side.
 *
 * KEEP IN SYNC with app/pipeline/page.tsx if Chris updates the production
 * stage mapping. Per CLAUDE.md, displayStage there is the canonical source —
 * mirror it here, don't diverge.
 */

export const PIPELINE_BUCKETS = [
  'Opportunity',
  'Submitted',
  'PreApproval',
  'Unconditional',
  'BuildContract',
  'Settled',
  'Lost',
] as const;
export type PipelineBucket = (typeof PIPELINE_BUCKETS)[number];

// In-progress stages (everything that isn't a terminal Lost / Settled).
export const ACTIVE_BUCKETS: PipelineBucket[] = [
  'Opportunity',
  'Submitted',
  'PreApproval',
  'Unconditional',
  'BuildContract',
];

// Adjacent-bucket transitions used to compute funnel conversion %.
// Each row: [from, to]. We compute (count_to_or_beyond / count_from_or_beyond)
// across the chosen window so it represents progression rather than instantaneous
// state. See sales/metrics.ts:funnel().
export const FUNNEL_TRANSITIONS: Array<[PipelineBucket, PipelineBucket]> = [
  ['Opportunity', 'Submitted'],
  ['Submitted', 'PreApproval'],
  ['PreApproval', 'Unconditional'],
  ['Unconditional', 'BuildContract'],
  ['BuildContract', 'Settled'],
];

/**
 * Map a Trail stage name to one of the dashboard buckets. Mirrors
 * displayStage() in app/pipeline/page.tsx — see that file for the
 * production rationale and the order-of-matches reasoning.
 */
export function displayStage(s: string | null | undefined): string {
  if (!s) return '';
  const n = s.toLowerCase().replace(/\s+/g, ' ').trim();

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

/** Returns true if `bucket` is one of the canonical 7 buckets. */
export function isKnownBucket(bucket: string): bucket is PipelineBucket {
  return (PIPELINE_BUCKETS as readonly string[]).includes(bucket);
}

// Advisers excluded from sales metrics — usually ex-staff with stale opps.
// Mirror of EXCLUDED_ADVISERS in app/pipeline/page.tsx.
export const EXCLUDED_ADVISERS = new Set<string>([
  'Aaron Cattell',
  'Alexey Papyshev',
  'Luke Stockman',
]);

// Only count opps in this Trail pipeline. Mirror of INCLUDED_PIPELINE.
export const INCLUDED_PIPELINE = 'Mortgage Advice';

/**
 * Filter predicate matching the dashboard's exclusion rules. Pass each
 * raw opportunity record (the `data` JSONB blob) through this before
 * counting it in any sales metric.
 */
export function isCountableOpportunity(data: {
  pipelineName?: string;
  adviserName?: string;
  isProfileArchived?: boolean;
}): boolean {
  if (data.pipelineName !== INCLUDED_PIPELINE) return false;
  if (data.adviserName && EXCLUDED_ADVISERS.has(data.adviserName)) return false;
  if (data.isProfileArchived) return false;
  return true;
}
