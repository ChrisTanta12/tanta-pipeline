import { NextRequest, NextResponse } from 'next/server';
import { isSalesAuthorized } from '@/app/lib/sales/auth';
import { loadLatestDigest } from '@/app/lib/sales/db';

export const dynamic = 'force-dynamic';

/**
 * Returns the most recent persisted digest from sales_digests. Used by the
 * /sales dashboard "Latest digest" panel and by the skill when Chris asks
 * "what did the latest digest say?".
 */
export async function GET(req: NextRequest) {
  if (!isSalesAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const row = await loadLatestDigest();
    if (!row) {
      return NextResponse.json({ digest: null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ digest: row }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: 'failed', detail: err.message }, { status: 500 });
  }
}
