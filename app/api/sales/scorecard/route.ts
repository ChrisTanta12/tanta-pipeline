import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';
import {
  loadBrevoContacts,
  loadKsConversions,
  loadOpportunities,
  loadStageHistory,
  loadTargets,
} from '@/app/lib/sales/db';
import { computeScorecard, proposeTargets } from '@/app/lib/sales/metrics';

export const dynamic = 'force-dynamic';

/**
 * One-shot scorecard the skill + digest both call. Returns scorecard lines
 * (metric / actual / target / status) plus alerts (stale, expiring, source
 * concentration, KS cross-sell candidates). If targets aren't set, we use
 * the auto-proposed baselines so the skill always has a number to compare to.
 */
export async function GET(req: NextRequest) {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const [opps, history, brevo, ksRows, stored] = await Promise.all([
      loadOpportunities(),
      loadStageHistory(),
      loadBrevoContacts(),
      loadKsConversions(),
      loadTargets(),
    ]);
    const targets = Object.keys(stored.current).length > 0
      ? stored.current
      : proposeTargets(opps, brevo, ksRows);
    return NextResponse.json(
      computeScorecard(opps, history, brevo, ksRows, targets),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}
