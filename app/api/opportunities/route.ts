import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

/**
 * Reads opportunities from the trail_entities cache (populated by the office-side
 * trail-sync script). Returns the same shape as the old Trail-proxying route
 * so the front-end doesn't need to change.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(searchParams.get('pageSize') ?? '500', 10)));
  const offset = (page - 1) * pageSize;

  try {
    const totalRes = await sql`
      SELECT COUNT(*) AS total FROM trail_entities WHERE kind = 'opportunity'
    `;
    // COUNT(*) returns bigint; @vercel/postgres hands it back as a string or number
    // depending on driver version. Number() normalises either case.
    const totalRecords = Number((totalRes.rows[0] as any)?.total ?? 0);

    const rowsRes = await sql<{ data: any; synced_at: string }>`
      SELECT data, synced_at
      FROM trail_entities
      WHERE kind = 'opportunity'
      ORDER BY (data->>'modifiedTimestamp') DESC NULLS LAST, entity_id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    // Latest sync info for the UI
    const lastSyncRes = await sql<{ finished_at: string | null; status: string; opportunities: number | null }>`
      SELECT finished_at, status, opportunities
      FROM trail_sync_jobs
      WHERE status IN ('done', 'failed')
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `;

    return NextResponse.json({
      records: rowsRes.rows.map(r => r.data),
      totalRecords,
      page,
      pageSize,
      lastSync: lastSyncRes.rows[0] ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to read opportunities from cache', detail: err.message },
      { status: 500 },
    );
  }
}
