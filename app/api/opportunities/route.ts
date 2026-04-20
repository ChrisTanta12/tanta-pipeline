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

    // Order by entity_id DESC (newest Trail IDs first). Joins:
    //   - opportunity_stage_history: computes cumulative days in current stage
    //     across all past visits to it (A → B → back to A keeps counting).
    //   - trail_profiles: pulls profileRank (client grade) + profileStatus.
    const rowsRes = await sql<{
      data: any;
      synced_at: string;
      stage_entered_at: string | null;
      days_in_stage: number | null;
      profile_rank: string | null;
      profile_status: string | null;
    }>`
      WITH current_stage AS (
        SELECT opportunity_id, stage_id, entered_at
        FROM opportunity_stage_history
        WHERE left_at IS NULL
      ),
      cumulative AS (
        SELECT h.opportunity_id,
               SUM(EXTRACT(EPOCH FROM (COALESCE(h.left_at, NOW()) - h.entered_at)) / 86400.0) AS days_in_stage
        FROM opportunity_stage_history h
        JOIN current_stage c ON c.opportunity_id = h.opportunity_id
                             AND c.stage_id = h.stage_id
        GROUP BY h.opportunity_id
      )
      SELECT t.data,
             t.synced_at,
             cs.entered_at           AS stage_entered_at,
             cum.days_in_stage       AS days_in_stage,
             p.profile_rank          AS profile_rank,
             p.profile_status        AS profile_status
      FROM trail_entities t
      LEFT JOIN current_stage  cs ON cs.opportunity_id = t.entity_id
      LEFT JOIN cumulative    cum ON cum.opportunity_id = t.entity_id
      LEFT JOIN trail_profiles p  ON p.profile_id = t.data->>'profileId'
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

    // Attach derived fields so the front-end can render accurately:
    //   - daysInCurrentStage: cumulative days across all visits to current stage
    //   - stageEnteredAt:     most recent entry timestamp (for tooltips)
    //   - profileRank:        client grade ("A"/"B"/"C"/null) from the profile
    //   - profileStatus:      "Prospect" / "Client" / etc. from the profile
    const records = rowsRes.rows.map(r => ({
      ...r.data,
      stageEnteredAt: r.stage_entered_at,
      daysInCurrentStage: r.days_in_stage !== null ? Number(r.days_in_stage) : null,
      profileRank: r.profile_rank,
      profileStatus: r.profile_status,
    }));

    return NextResponse.json({
      records,
      totalRecords,
      page,
      pageSize,
      lastSync: lastSyncRes.rows[0] ?? null,
    }, {
      // Prevent Vercel edge and any intermediate cache from serving stale
      // responses. `dynamic = 'force-dynamic'` tells Next.js not to cache,
      // but the edge layer can still cache without this explicit header.
      // Stale cached responses have previously caused profileRank/daysInCurrentStage
      // to disappear from the UI even after the code was updated.
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to read opportunities from cache', detail: err.message },
      { status: 500 },
    );
  }
}
