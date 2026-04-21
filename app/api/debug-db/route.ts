import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/**
 * Diagnostic: confirms the function reads the SAME database that the
 * /api/bank-rates-ingest and seed scripts write to. Returns:
 *   - pgHostPrefix:    first 10 chars of POSTGRES_HOST (identifies the endpoint)
 *   - pgUrlHash:       sha256 of POSTGRES_URL (match against local hash to confirm identity)
 *   - anzUpdatedAt:    last time anz row was written
 *   - anz1yRate:       current ANZ 1y rateCard in the DB
 *
 * Delete this endpoint once the staleness issue is resolved.
 */
export async function GET() {
  const pgUrl = process.env.POSTGRES_URL ?? '';
  const pgHost = process.env.POSTGRES_HOST ?? '';
  const urlHash = createHash('sha256').update(pgUrl).digest('hex').slice(0, 16);

  const { rows } = await sql<{
    updated_at: string;
    one_y: unknown;
    eff: string | null;
  }>`
    SELECT updated_at::text AS updated_at,
           data->'rateCard'->'1y' AS one_y,
           data->'fees'->>'rateCardEffectiveDate' AS eff
    FROM banks WHERE id = 'anz'
  `;

  return NextResponse.json(
    {
      pgHostPrefix: pgHost.slice(0, 10),
      pgUrlHash: urlHash,
      pgUrlLength: pgUrl.length,
      anzUpdatedAt: rows[0]?.updated_at ?? null,
      anz1yRate: rows[0]?.one_y ?? null,
      anzEffectiveDate: rows[0]?.eff ?? null,
      serverNow: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } },
  );
}
