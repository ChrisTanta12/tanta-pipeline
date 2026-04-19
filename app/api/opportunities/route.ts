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

    // Order by entity_id DESC (newest Trail IDs first). The stage-history
    // join computes "days in current stage cumulative across all past visits"
    // — so a deal that moved A → B → back to A continues counting from its
    // very first visit to A, not from the most recent transition back.
    //
    //   days_in_stage = sum over all history rows where stage_id matches
    //                    the current open stage, of (COALESCE(left_at, NOW) - entered_at)
    const rowsRes = await sql<{ data: any; synced_at: string; stage_entered_at: string | null; days_in_stage: number | null }>`
      WITH current_stage AS (
        SELECT opportunity_id, stage_id, entered_at
        FROM opportunity_stage_history
        WHERE left_at IS NULL
      ),
      cumulative AS (
        SELECT h.opportunity_id,
               SUM(EXTRACT(EPOCH FROM (COALESCE(h.left_at, NOW()) - h.entered_at)) / 86400.0) AS days_in_stage,
               MIN(h.entered_at) AS first_entered
        FROM opportunity_stage_history h
        JOIN current_stage c ON c.opportunity_id = h.opportunity_id
                             AND c.stage_id = h.stage_id
        GROUP BY h.opportunity_id
      )
      SELECT t.data,
             t.synced_at,
             cs.entered_at          AS stage_entered_at,
             cum.days_in_stage      AS days_in_stage
      FROM trail_entities t
      LEFT JOIN current_stage cs ON cs.opportunity_id = t.entity_id
      LEFT JOIN cumulative   cum ON cum.opportunity_id = t.entity_id
      WHERE t.kind = 'opportunity'
      ORDER BY t.entity_id DESC
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

    // Attach daysInCurrentStage (cumulative across visits) + stageEnteredAt
    // (most recent entry, for reference) so the front-end can render deal
    // ageing accurately. Falls back to null when we haven't tracked the opp
    // yet (new deal between last sync and this page load).
    const records = rowsRes.rows.map(r => ({
      ...r.data,
      stageEnteredAt: r.stage_entered_at,
      daysInCurrentStage: r.days_in_stage !== null ? Number(r.days_in_stage) : null,
    }));

    return NextResponse.json({
      records,
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
