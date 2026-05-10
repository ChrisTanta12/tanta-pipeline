import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';
import { renderDigestMarkdown } from '@/app/lib/sales/digest';
import {
  loadBrevoContacts,
  loadKsConversions,
  loadOpportunities,
  loadStageHistory,
  loadTargets,
  loadTrailKiwisavers,
} from '@/app/lib/sales/db';
import {
  computeExpiringPreApprovals,
  computeKsAttach,
  computeLeads,
  computeScorecard,
  computeSourceMix,
  computeStale,
  proposeTargets,
} from '@/app/lib/sales/metrics';

export const dynamic = 'force-dynamic';

/**
 * Renders the weekly sales digest as markdown. The cron writer fetches this
 * and writes the body to Drive; the skill can fetch it on demand.
 *
 * Format query param: ?format=markdown (default) | json (for the skill to
 * present already-formatted text without re-rendering).
 */
export async function GET(req: NextRequest) {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const format = (searchParams.get('format') ?? 'markdown').toLowerCase();
  try {
    const [opps, history, brevo, ksRows, stored, trailKs] = await Promise.all([
      loadOpportunities(),
      loadStageHistory(),
      loadBrevoContacts(),
      loadKsConversions(),
      loadTargets(),
      loadTrailKiwisavers(),
    ]);
    const targets = Object.keys(stored.current).length > 0
      ? stored.current
      : proposeTargets(opps, brevo, ksRows);
    const ceiling = targets.sourceConcentrationCeilingPct ?? 70;

    const inputs = {
      scorecard: computeScorecard(opps, history, brevo, ksRows, targets, undefined, trailKs),
      weekLeads: computeLeads(opps, brevo, 'week'),
      stale: computeStale(opps, 14),
      expiring: computeExpiringPreApprovals(opps, 30),
      sourceMix: computeSourceMix(opps, brevo, 90, ceiling),
      ksAttach: computeKsAttach(opps, ksRows, 90, undefined, trailKs),
    };
    const md = renderDigestMarkdown(inputs);

    if (format === 'json') {
      return NextResponse.json(
        { markdown: md, scorecard: inputs.scorecard },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return new NextResponse(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}
