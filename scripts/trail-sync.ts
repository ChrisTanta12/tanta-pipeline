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
 *
 * Trail API reference: see Claude Home Base/Trail Integration/trail-api-docs.md
 *   and Claude Home Base/Trail Integration/trail-api-howto.md for practical tips.
 *   Response envelope for lists: { status, message, data: { items, totalItems, page, pageSize, totalPages } }
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

  // Clean up orphaned 'running' jobs — typically from a previous run that
  // crashed before it could mark itself done/failed. Anything more than 30 min
  // old that's still 'running' is stuck and should be marked as failed.
  await sql`
    UPDATE trail_sync_jobs
    SET status = 'failed',
        finished_at = NOW(),
        error = COALESCE(error, '') || ' [marked failed by subsequent run — script may have crashed]'
    WHERE status = 'running' AND started_at < NOW() - INTERVAL '30 minutes'
  `;

  let jobId: number | null = null;
  let requestedBy: 'schedule' | 'manual' | 'startup' = 'schedule';

  if (mode === 'check') {
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
    // Trail's /pipelines/search endpoint rejects an empty searchString ("Search string
    // is required"). Rather than fetch pipelines via the API at all, we derive them
    // from the opportunities we just pulled — every opportunity carries
    // pipelineId / pipelineName / stageId / stageName, which is everything the
    // dashboard needs.
    const pipelines = derivePipelinesFromOpportunities(opps);
    console.log(`[trail-sync]   derived ${pipelines.length} pipelines from opportunities`);

    await upsertEntities('opportunity', opps, 'opportunityId');
    await upsertEntities('pipeline', pipelines, 'pipelineId');
    const stageChanges = await trackStageChanges(opps);
    console.log(`[trail-sync]   ${stageChanges} stage changes detected this run`);

    // Profiles — paginated list, then upsert rank/status/full body. Separate
    // try/catch so profile-sync failure doesn't kill the whole job.
    let profileCount = 0;
    try {
      const profiles = await fetchAllProfiles();
      await upsertProfiles(profiles);
      profileCount = profiles.length;
      console.log(`[trail-sync]   profiles synced: ${profileCount}`);
    } catch (err: any) {
      console.warn(`[trail-sync]   profile sync failed (continuing): ${err.message}`);
    }

    await sql`
      UPDATE trail_sync_jobs
      SET status='done', finished_at=NOW(), opportunities=${opps.length}, pipelines=${pipelines.length}
      WHERE id=${jobId}
    `;
    console.log(`[trail-sync] ✓ done — ${opps.length} opportunities, ${pipelines.length} pipelines, ${profileCount} profiles`);
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

/**
 * Generic paginated GET helper.
 * Docs confirm all list endpoints return: { data: { items, totalItems, page, pageSize, totalPages } }
 */
async function fetchPaginated(label: string, path: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${TRAIL_BASE_URL}${path}${sep}page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: { Authorization: TRAIL_API_KEY } });
    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>');
      throw new Error(`Trail ${label} ${res.status}: ${body}`);
    }
    const body = await res.json();
    // Tolerate the documented { data: { items, totalItems } } shape plus legacy shapes.
    const envelope = body?.data ?? body;
    const items: any[] = envelope?.items ?? envelope?.records ?? (Array.isArray(body) ? body : []);
    const total: number | undefined =
      envelope?.totalItems ?? envelope?.totalRecords ?? envelope?.total ?? undefined;

    out.push(...items);
    console.log(`[trail-sync]   ${label} page ${page}: ${items.length} items (${out.length}${total !== undefined ? `/${total}` : ''})`);

    if (items.length === 0) break;
    if (total !== undefined && out.length >= total) break;
    if (items.length < PAGE_SIZE) break;
    page++;
  }
  return out;
}

async function fetchAllOpportunities(): Promise<any[]> {
  // Use the plain list endpoint. Trail's /opportunities/search requires a non-empty
  // searchString; /opportunities accepts page+pageSize and returns everything.
  return fetchPaginated('opportunities', '/opportunities');
}

async function fetchAllProfiles(): Promise<any[]> {
  // Profile list endpoint — assumes same pagination/shape as opportunities.
  // Returns the full profile record including profileRank, profileStatus, contacts, etc.
  return fetchPaginated('profiles', '/profiles');
}

async function upsertProfiles(profiles: any[]) {
  if (profiles.length === 0) return;
  // Smaller chunks (was 200, now 50) after a Neon out-of-memory on the first
  // try — the serverless Postgres connection cache couldn't hold 200 parallel
  // queries with JSONB payloads. Also: we no longer write the full JSONB body
  // since nothing reads it. If we ever need contacts/profileSource/etc later,
  // we can re-add it, but for the current rank-only use case, skipping the
  // JSONB makes the upsert ~10x lighter.
  const CHUNK = 50;
  for (let i = 0; i < profiles.length; i += CHUNK) {
    const slice = profiles.slice(i, i + CHUNK);
    await Promise.all(slice.map(p => {
      const id = p.profileId;
      if (!id || typeof id !== 'string') return Promise.resolve();
      return sql`
        INSERT INTO trail_profiles (profile_id, profile_rank, profile_status, synced_at)
        VALUES (${id}, ${p.profileRank ?? null}, ${p.profileStatus ?? null}, NOW())
        ON CONFLICT (profile_id) DO UPDATE
          SET profile_rank   = EXCLUDED.profile_rank,
              profile_status = EXCLUDED.profile_status,
              synced_at      = NOW()
      `;
    }));
  }
}

/**
 * Pipelines don't have a plain list endpoint we can call (only /pipelines/search,
 * which requires a non-empty searchString). But every opportunity carries
 * pipelineId/pipelineName/stageId/stageName denormalised, so we can derive the
 * full pipeline+stage list from the opportunities we just fetched without
 * another API call.
 */
function derivePipelinesFromOpportunities(opps: any[]): any[] {
  const pipelines = new Map<number, { pipelineId: number; pipelineName: string; stages: Map<number, { stageId: number; stageName: string }> }>();
  for (const o of opps) {
    const pid = o.pipelineId;
    if (pid === undefined || pid === null) continue;
    if (!pipelines.has(pid)) {
      pipelines.set(pid, { pipelineId: pid, pipelineName: o.pipelineName ?? '', stages: new Map() });
    }
    if (o.stageId !== undefined && o.stageId !== null) {
      pipelines.get(pid)!.stages.set(o.stageId, { stageId: o.stageId, stageName: o.stageName ?? '' });
    }
  }
  return Array.from(pipelines.values()).map(p => ({
    pipelineId: p.pipelineId,
    pipelineName: p.pipelineName,
    stages: Array.from(p.stages.values()),
  }));
}

/**
 * Maintains opportunity_stage_history — append-only log of every stage visit
 * per opportunity. Lets the dashboard compute "cumulative days in current
 * stage across all visits" (so a deal that moved A → B → back to A continues
 * its A counter rather than resetting).
 *
 * For each opp we look at the currently-open row (left_at IS NULL):
 *   - No row yet → insert with entered_at = modifiedTimestamp (best
 *     approximation on first observation — upper bound on stage age).
 *   - Open row, same stage_id → nothing to do.
 *   - Open row, different stage_id → close it (left_at = NOW) and insert a
 *     new open row for the new stage.
 *
 * Returns the count of stage transitions detected this run.
 */
async function trackStageChanges(opps: any[]): Promise<number> {
  if (opps.length === 0) return 0;
  let changes = 0;
  const CHUNK = 50;
  for (let i = 0; i < opps.length; i += CHUNK) {
    const slice = opps.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map(async o => {
      if (o.opportunityId === undefined || o.opportunityId === null || o.stageId === undefined || o.stageId === null) {
        return false;
      }

      // Find the currently-open stage row for this opportunity.
      const cur = await sql<{ stage_id: string | number; entered_at: string }>`
        SELECT stage_id, entered_at
        FROM opportunity_stage_history
        WHERE opportunity_id = ${o.opportunityId} AND left_at IS NULL
        LIMIT 1
      `;

      const currentStageId = cur.rows[0]?.stage_id !== undefined
        ? Number(cur.rows[0].stage_id)
        : null;

      if (currentStageId === null) {
        // First time we've ever seen this opp — seed with modifiedTimestamp.
        const seed = o.modifiedTimestamp ?? o.createdTimestamp ?? new Date().toISOString();
        await sql`
          INSERT INTO opportunity_stage_history (opportunity_id, stage_id, stage_name, entered_at, left_at)
          VALUES (${o.opportunityId}, ${o.stageId}, ${o.stageName ?? ''}, ${seed}, NULL)
          ON CONFLICT (opportunity_id, entered_at) DO NOTHING
        `;
        return false; // not a detected transition — just initial observation
      }

      if (currentStageId === Number(o.stageId)) {
        return false; // no change
      }

      // Stage has moved — close the current row, open a new one.
      await sql`
        UPDATE opportunity_stage_history
        SET left_at = NOW()
        WHERE opportunity_id = ${o.opportunityId} AND left_at IS NULL
      `;
      await sql`
        INSERT INTO opportunity_stage_history (opportunity_id, stage_id, stage_name, entered_at, left_at)
        VALUES (${o.opportunityId}, ${o.stageId}, ${o.stageName ?? ''}, NOW(), NULL)
      `;
      return true;
    }));
    changes += results.filter(Boolean).length;
  }
  return changes;
}

async function upsertEntities(kind: 'opportunity' | 'pipeline', records: any[], idField: string) {
  if (records.length === 0) return;
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
