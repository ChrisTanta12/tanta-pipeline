import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';
import { loadOpportunities } from '@/app/lib/sales/db';
import { computeExpiringPreApprovals } from '@/app/lib/sales/metrics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') ?? '30', 10);
  const within = Number.isFinite(days) && days > 0 ? Math.min(180, days) : 30;
  try {
    const opps = await loadOpportunities();
    return NextResponse.json(computeExpiringPreApprovals(opps, within), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}
