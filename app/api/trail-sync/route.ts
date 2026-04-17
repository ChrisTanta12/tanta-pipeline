import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';

/**
 * POST — dashboard clicks "Sync now"; we insert a pending job. The office-side
 * trail-sync script picks it up within 2 minutes.
 *
 * GET — returns the most recent job statuses for the UI.
 */
export async function POST() {
  try {
    // If there's already a pending or running job, don't queue another — just return it.
    const existing = await sql<{ id: number; status: string; requested_at: string }>`
      SELECT id, status, requested_at
      FROM trail_sync_jobs
      WHERE status IN ('pending', 'running')
      ORDER BY requested_at DESC
      LIMIT 1
    `;
    if (existing.rows.length > 0) {
      return NextResponse.json({ queued: false, existing: existing.rows[0] });
    }

    const insert = await sql<{ id: number; requested_at: string }>`
      INSERT INTO trail_sync_jobs (status, requested_by)
      VALUES ('pending', 'manual')
      RETURNING id, requested_at
    `;
    return NextResponse.json({ queued: true, job: insert.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const res = await sql<{
      id: number;
      requested_at: string;
      started_at: string | null;
      finished_at: string | null;
      status: string;
      requested_by: string | null;
      opportunities: number | null;
      pipelines: number | null;
      error: string | null;
    }>`
      SELECT id, requested_at, started_at, finished_at, status, requested_by, opportunities, pipelines, error
      FROM trail_sync_jobs
      ORDER BY requested_at DESC
      LIMIT 10
    `;
    return NextResponse.json({ jobs: res.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
