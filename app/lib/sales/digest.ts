/**
 * Renders the weekly sales digest as markdown. Pure: takes a fully-loaded
 * scorecard and the supporting endpoint shapes, returns a string. Used
 * by the /api/sales/digest route and the weekly-digest cron writer.
 */
import type {
  ExpiringPreApprovalsResponse,
  KsAttachResponse,
  LeadsResponse,
  ScorecardLine,
  ScorecardResponse,
  SourceMixResponse,
  StaleLeadsResponse,
} from './types';

const STATUS_BADGE: Record<ScorecardLine['status'], string> = {
  'on-track':  '🟢',
  'at-risk':   '🟡',
  'off-track': '🔴',
  'no-target': '◯',
};

function formatLine(l: ScorecardLine): string {
  const target = l.target != null ? ` / target ${l.target}${l.unit === '%' ? '%' : ''}` : '';
  const unit = l.unit === '$' ? '' : (l.unit === '%' ? '%' : '');
  return `- ${STATUS_BADGE[l.status]} **${l.metric}**: ${l.actual}${unit}${target}`;
}

export type DigestInputs = {
  scorecard: ScorecardResponse;
  weekLeads: LeadsResponse;
  stale: StaleLeadsResponse;
  expiring: ExpiringPreApprovalsResponse;
  sourceMix: SourceMixResponse;
  ksAttach: KsAttachResponse;
};

export function renderDigestMarkdown(d: DigestInputs): string {
  const { scorecard, weekLeads, stale, expiring, sourceMix, ksAttach } = d;
  const generated = new Date(scorecard.generatedAt).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const out: string[] = [];
  out.push(`# Sales digest — week of ${weekLeads.windowStart}`);
  out.push('');
  out.push(`Generated ${generated} NZT.`);
  out.push('');

  // ----- Scorecard
  out.push(`## Scorecard (fortnight to ${scorecard.windowEnd})`);
  out.push('');
  for (const l of scorecard.lines) out.push(formatLine(l));
  out.push('');

  // ----- New leads
  out.push(`## New leads — ${weekLeads.total} this week`);
  out.push('');
  if (weekLeads.bySource.length > 0) {
    out.push('| Source | Count |');
    out.push('|---|---:|');
    for (const r of weekLeads.bySource.slice(0, 10)) {
      out.push(`| ${r.source} | ${r.count} |`);
    }
    out.push('');
  } else {
    out.push('_No new leads in window._');
    out.push('');
  }
  out.push('4-week trend:');
  out.push('');
  out.push('| Period | Count |');
  out.push('|---|---:|');
  for (const t of weekLeads.trend) {
    out.push(`| ${t.periodStart} → ${t.periodEnd} | ${t.count} |`);
  }
  out.push('');

  // ----- Things that need attention
  out.push('## Things to look at');
  out.push('');
  if (scorecard.alerts.length === 0) {
    out.push('_All quiet._');
  } else {
    for (const a of scorecard.alerts) {
      const icon = a.severity === 'red' ? '🔴' : a.severity === 'warn' ? '🟡' : 'ℹ️';
      out.push(`- ${icon} **${a.title}**${a.detail ? ` — ${a.detail}` : ''}`);
    }
  }
  out.push('');

  // ----- Stale leads
  if (stale.total > 0) {
    out.push(`## Stale leads (> ${stale.thresholdDays} days in stage)`);
    out.push('');
    out.push('| Bucket | Client | Adviser | Days | Value |');
    out.push('|---|---|---|---:|---:|');
    for (const b of stale.byBucket) {
      for (const l of b.leads.slice(0, 5)) {
        const v = l.value > 0 ? `$${Math.round(l.value).toLocaleString('en-NZ')}` : '';
        out.push(`| ${l.bucket} | ${l.profileName} | ${l.adviserName} | ${l.daysInStage} | ${v} |`);
      }
    }
    out.push('');
  }

  // ----- Expiring pre-approvals
  if (expiring.total > 0) {
    out.push(`## Pre-approvals expiring within ${expiring.withinDays} days`);
    out.push('');
    out.push('| Client | Adviser | Lender | Expires | Days |');
    out.push('|---|---|---|---|---:|');
    for (const e of expiring.expirations.slice(0, 10)) {
      out.push(`| ${e.profileName} | ${e.adviserName} | ${e.lender} | ${e.expiresAt} | ${e.daysUntilExpiry} |`);
    }
    out.push('');
  }

  // ----- KS cross-sell candidates
  if (ksAttach.candidates.length > 0) {
    out.push(`## KiwiSaver cross-sell candidates`);
    out.push('');
    out.push(`Settled mortgage clients in last ${ksAttach.windowDays} days who aren't in \`ks-conversions.md\`. Add them to the tracker as you book them.`);
    out.push('');
    out.push('| Client | Settled |');
    out.push('|---|---|');
    for (const c of ksAttach.candidates.slice(0, 10)) {
      out.push(`| ${c.profileName} | ${c.mortgageSettledDate ?? ''} |`);
    }
    out.push('');
  }

  // ----- Source mix snapshot
  out.push('## Source mix (last 90 days)');
  out.push('');
  if (sourceMix.bySource.length > 0) {
    out.push(`Top source: **${sourceMix.bySource[0].source}** at ${sourceMix.topSourcePct}%${sourceMix.concentrationFlag ? ` ⚠️ above ${sourceMix.concentrationCeilingPct}% ceiling` : ''}.`);
    out.push('');
    out.push('| Source | Count |');
    out.push('|---|---:|');
    for (const r of sourceMix.bySource.slice(0, 10)) {
      out.push(`| ${r.source} | ${r.count} |`);
    }
    out.push('');
  }

  // ----- Next-week focus
  out.push('## Suggested focus next week');
  out.push('');
  out.push(suggestFocus(scorecard, stale, expiring, ksAttach, sourceMix));
  out.push('');

  return out.join('\n');
}

function suggestFocus(
  scorecard: ScorecardResponse,
  stale: StaleLeadsResponse,
  expiring: ExpiringPreApprovalsResponse,
  ksAttach: KsAttachResponse,
  sourceMix: SourceMixResponse,
): string {
  // Priority order: red alerts > expiring pre-approvals > biggest gap-vs-target.
  const reds = scorecard.alerts.filter((a) => a.severity === 'red');
  if (reds.length > 0) return `Top priority: ${reds[0].title}.`;
  if (expiring.total > 0) {
    const e = expiring.expirations[0];
    return `Re-engage **${e.profileName}** — pre-approval expires in ${e.daysUntilExpiry} days.`;
  }
  if (sourceMix.concentrationFlag) {
    return `Diversify lead sources. **${sourceMix.bySource[0].source}** is ${sourceMix.topSourcePct}% of inflow — push at least one other channel this week.`;
  }
  if (ksAttach.candidates.length > 0) {
    return `Book KS reviews for ${ksAttach.candidates.length} settled mortgage clients without a KS product yet.`;
  }
  if (stale.total > 0) {
    const top = stale.byBucket[0]?.leads[0];
    if (top) return `Move **${top.profileName}** out of ${top.bucket} (${top.daysInStage} days).`;
  }
  // Biggest gap: pick the line with the most negative actual/target ratio.
  const withTargets = scorecard.lines.filter((l) => l.target != null && l.target > 0);
  withTargets.sort((a, b) => (a.actual / (a.target ?? 1)) - (b.actual / (b.target ?? 1)));
  const worst = withTargets[0];
  if (worst && worst.actual < (worst.target ?? 0)) {
    return `Push on **${worst.metric}** — currently ${worst.actual} vs target ${worst.target}.`;
  }
  return 'On track. Look for a discretionary win — KS conversion or lead-source experiment.';
}
