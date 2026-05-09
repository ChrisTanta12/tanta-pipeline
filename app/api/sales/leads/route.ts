import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';
import { loadBrevoContacts, loadOpportunities } from '@/app/lib/sales/db';
import { computeLeads, type WindowKind } from '@/app/lib/sales/metrics';

export const dynamic = 'force-dynamic';

const VALID_WINDOWS: WindowKind[] = ['week', 'fortnight', 'month', 'quarter'];

export async function GET(req: NextRequest) {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get('window') ?? 'week') as WindowKind;
  const window = VALID_WINDOWS.includes(raw) ? raw : 'week';
  try {
    const [opps, brevo] = await Promise.all([loadOpportunities(), loadBrevoContacts()]);
    return NextResponse.json(computeLeads(opps, brevo, window), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}
