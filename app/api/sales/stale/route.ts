import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';
import { loadOpportunities } from '@/app/lib/sales/db';
import { computeStale } from '@/app/lib/sales/metrics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const daysParam = parseInt(searchParams.get('days') ?? '14', 10);
  const threshold = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(365, daysParam) : 14;
  try {
    const opps = await loadOpportunities();
    return NextResponse.json(computeStale(opps, threshold), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}
