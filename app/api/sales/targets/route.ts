import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';
import {
  loadBrevoContacts,
  loadKsConversions,
  loadOpportunities,
  loadTargets,
  saveTargets,
} from '@/app/lib/sales/db';
import { proposeTargets } from '@/app/lib/sales/metrics';
import type { SalesTargets, TargetsResponse } from '@/app/lib/sales/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const [stored, opps, brevo, ksRows] = await Promise.all([
      loadTargets(),
      loadOpportunities(),
      loadBrevoContacts(),
      loadKsConversions(),
    ]);
    const proposed = proposeTargets(opps, brevo, ksRows);
    const body: TargetsResponse = {
      current: stored.current,
      proposed,
      updatedBy: stored.updatedBy,
      updatedAt: stored.updatedAt,
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { targets?: SalesTargets; updatedBy?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.targets || typeof body.targets !== 'object') {
    return NextResponse.json({ error: 'targets required' }, { status: 400 });
  }
  // Allowlist fields so callers can't write arbitrary JSON into the row.
  const t = body.targets;
  const safe: SalesTargets = {};
  if (typeof t.settlementsPerFortnight === 'number') safe.settlementsPerFortnight = t.settlementsPerFortnight;
  if (typeof t.newLeadsPerWeek === 'number') safe.newLeadsPerWeek = t.newLeadsPerWeek;
  if (typeof t.ksAttachPct === 'number') safe.ksAttachPct = t.ksAttachPct;
  if (typeof t.sourceConcentrationCeilingPct === 'number') {
    safe.sourceConcentrationCeilingPct = t.sourceConcentrationCeilingPct;
  }
  const updatedBy = (body.updatedBy ?? 'manual').toString().slice(0, 64);
  await saveTargets(safe, updatedBy);
  return NextResponse.json({ ok: true, current: safe });
}
