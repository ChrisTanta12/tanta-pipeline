import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';
import { loadKsConversions, loadOpportunities } from '@/app/lib/sales/db';
import { computeKsAttach } from '@/app/lib/sales/metrics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const window = parseInt(searchParams.get('window') ?? '90', 10);
  const days = Number.isFinite(window) && window > 0 ? Math.min(365, window) : 90;
  try {
    const [opps, ksRows] = await Promise.all([loadOpportunities(), loadKsConversions()]);
    return NextResponse.json(computeKsAttach(opps, ksRows, days), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}
