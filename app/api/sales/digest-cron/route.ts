import { NextRequest, NextResponse } from 'next/server';
import { renderDigestMarkdown } from '@/app/lib/sales/digest';
import {
  loadBrevoContacts,
  loadKsConversions,
  loadOpportunities,
  loadStageHistory,
  loadTargets,
  saveDigest,
} from '@/app/lib/sales/db';
import {
  computeExpiringPreApprovals,
  computeKsAttach,
  computeLeads,
  computeScorecard,
  computeSourceMix,
  computeStale,
  iso,
  proposeTargets,
} from '@/app/lib/sales/metrics';

export const dynamic = 'force-dynamic';

/**
 * Vercel cron entry point. Runs Mondays at 7am NZT (configured in vercel.json).
 *
 * Auth: Vercel cron requests carry a header `Authorization: Bearer <CRON_SECRET>`
 * when `CRON_SECRET` is set in env (Vercel-managed). We accept either that or
 * the SALES_API_TOKEN so a manual trigger from the office still works.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const apiToken = process.env.SALES_API_TOKEN;
  const auth = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const provided = m?.[1] ?? '';
  const ok =
    (cronSecret && provided === cronSecret) ||
    (apiToken && provided === apiToken);
  if (!ok) {
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
    const ceiling = targets.sourceConcentrationCeilingPct ?? 70;

    const now = new Date();
    const cycleEnd = new Date(now);
    const cycleStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

    const inputs = {
      scorecard: computeScorecard(opps, history, brevo, ksRows, targets, now),
      weekLeads: computeLeads(opps, brevo, 'week', now),
      stale: computeStale(opps, 14),
      expiring: computeExpiringPreApprovals(opps, 30, now),
      sourceMix: computeSourceMix(opps, brevo, 90, ceiling, now),
      ksAttach: computeKsAttach(opps, ksRows, 90, now),
    };
    const markdown = renderDigestMarkdown(inputs);

    await saveDigest({
      cycleStart: iso(cycleStart),
      cycleEnd: iso(cycleEnd),
      generatedAt: now.toISOString(),
      scorecard: inputs.scorecard,
      markdown,
    });

    return NextResponse.json({
      ok: true,
      cycleStart: iso(cycleStart),
      cycleEnd: iso(cycleEnd),
      bytes: markdown.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}
