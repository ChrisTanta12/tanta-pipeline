/**
 * Trail CRM → Postgres sync.
 *
 * Runs on a machine whose IP is whitelisted in Trail (your office PC).
 * Fetches all opportunities and pipelines from Trail and upserts them into
 * the `trail_entities` table on Neon Postgres. Vercel routes then read from
 * Postgres instead of calling Trail directly.
 *
 * Usage:
 *   npm run trail:sync            # full sync (used by Task Scheduler morning/evening)
 *   npm run trail:sync -- --check # only runs if a pending job exists (Task Scheduler every 2 min)
 *
 * Required env (load via .env.local or export in the shell):
 *   POSTGRES_URL     # Neon connection string
 *   TRAIL_API_KEY    # your Trail API key
 *   TRAIL_BASE_URL   # default 'https://beta.api.gettrail.com/api/v1'
 */
import { sql } from '@vercel/postgres';

const TRAIL_BASE_URL = process.env.TRAIL_BASE_URL || 'https://beta.api.gettrail.com/api/v1';
const TRAIL_API_KEY = process.env.TRAIL_API_KEY || '';
const PAGE_SIZE = 500;

type Mode = 'full' | 'check';
const mode: Mode = process.argv.includes('--check') ? 'check' : 'full';

async function main() {
  if (!TRAIL_API_KEY) throw new Error('TRAIL_API_KEY is not set');
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is not set (is .env.local loaded?)');

  let jobId: number | null = null;
  let requestedBy: 'schedule' | 'manual' | 'startup' = 'schedule';

  if (mode === 'check') {
    // Find oldest pending job, claim it by setting status=running.
    const claim = await sql<{ id: number; requested_by: string | null }>`
      UPDATE trail_sync_jobs
      SET status = 'running', started_at = NOW()
      WHERE id = (
        SELECT id FROM trail_sync_jobs
        WHERE status = 'pending'
        ORDER BY requested_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, requested_by
    `;
    if (claim.rows.length === 0) {
      console.log('[trail-sync] no pending jobs; exiting');
      return;
    }
    jobId = claim.rows[0].id;
    requestedBy = (claim.rows[0].requested_by as any) ?? 'manual';
    console.log(`[trail-sync] picked up job ${jobId} (${requestedBy})`);
  } else {
    // Full scheduled sync — create our own job row so history is consistent.
    const insert = await sql<{ id: number }>`
      INSERT INTO trail_sync_jobs (status, started_at, requested_by)
      VALUES ('running', NOW(), 'schedule')
      RETURNING id
    `;
    jobId = insert.rows[0].id;
    console.log(`[trail-sync] starting scheduled sync, job ${jobId}`);
  }

  try {
    const opps = await fetchAllOpportunities();
    const pipelines = await fetchPipelines();

    await upsertEntities('opportunity', opps, 'opportunityId');
    await upsertEntities('pipeline', pipelines, 'pipelineId');

    await sql`
      UPDATE trail_sync_jobs
      SET status='done', finished_at=NOW(), opportunities=${opps.length}, pipelines=${pipelines.length}
      WHERE id=${jobId}
    `;
    console.log(`[trail-sync] ✓ done — ${opps.length} opportunities, ${pipelines.length} pipelines`);
  } catch (err: any) {
    await sql`
      UPDATE trail_sync_jobs
      SET status='failed', finished_at=NOW(), error=${err.message ?? String(err)}
      WHERE id=${jobId}
    `;
    console.error('[trail-sync] ✗ failed:', err.message ?? err);
    process.exit(1);
  }
}

async function fetchAllOpportunities(): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const url = `${TRAIL_BASE_URL}/opportunities?page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: { Authorization: TRAIL_API_KEY } });
    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>');
      throw new Error(`Trail opportunities ${res.status}: ${body}`);
    }
    const data = await res.json();
    const records: any[] = data.records ?? [];
    out.push(...records);
    const total = data.totalRecords ?? out.length;
    console.log(`[trail-sync]   page ${page}: ${records.length} records (${out.length}/${total})`);
    if (records.length === 0 || out.length >= total) break;
    page++;
  }
  return out;
}

async function fetchPipelines(): Promise<any[]> {
  const res = await fetch(`${TRAIL_BASE_URL}/pipelines`, { headers: { Authorization: TRAIL_API_KEY } });
  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(`Trail pipelines ${res.status}: ${body}`);
  }
  const data = await res.json();
  // The pipelines endpoint may return either { records: [...] } or a bare array.
  return data.records ?? (Array.isArray(data) ? data : []);
}

async function upsertEntities(kind: 'opportunity' | 'pipeline', records: any[], idField: string) {
  if (records.length === 0) return;
  // Chunk upserts so we don't blow out a single transaction.
  const CHUNK = 100;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    await Promise.all(slice.map(r => {
      const entityId = r[idField];
      if (entityId === undefined || entityId === null) return Promise.resolve();
      return sql`
        INSERT INTO trail_entities (kind, entity_id, data, synced_at)
        VALUES (${kind}, ${entityId}, ${JSON.stringify(r)}::jsonb, NOW())
        ON CONFLICT (kind, entity_id) DO UPDATE
          SET data = EXCLUDED.data,
              synced_at = NOW()
      `;
    }));
  }
}

main().catch(err => {
  console.error('[trail-sync] unhandled error:', err);
  process.exit(1);
});
