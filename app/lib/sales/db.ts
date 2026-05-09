/**
 * Postgres reads + writes for the sales surfaces. Keeps SQL in one place
 * so the metric module can stay pure JS and easily unit-testable.
 */
import { sql } from '@vercel/postgres';
import type {
  BrevoContactRow,
  KsConversionRow,
  OpportunityRow,
  StageHistoryRow,
} from './metrics';
import type { SalesTargets } from './types';

/**
 * Loads opportunities with the same join as /api/opportunities (cumulative
 * days-in-current-stage + profile rank/status). Returns the shape the
 * metric functions expect.
 */
export async function loadOpportunities(): Promise<OpportunityRow[]> {
  const { rows } = await sql<{
    data: any;
    days_in_stage: number | null;
    stage_entered_at: string | null;
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
           cum.days_in_stage AS days_in_stage,
           cs.entered_at     AS stage_entered_at
    FROM trail_entities t
    LEFT JOIN current_stage cs ON cs.opportunity_id = t.entity_id
    LEFT JOIN cumulative   cum ON cum.opportunity_id = t.entity_id
    WHERE t.kind = 'opportunity'
  `;
  return rows.map((r) => ({
    data: r.data,
    daysInCurrentStage: r.days_in_stage !== null ? Number(r.days_in_stage) : null,
    stageEnteredAt: r.stage_entered_at,
  }));
}

export async function loadStageHistory(): Promise<StageHistoryRow[]> {
  const { rows } = await sql<{
    opportunity_id: number | string;
    stage_id: number | string;
    stage_name: string | null;
    entered_at: string;
    left_at: string | null;
  }>`
    SELECT opportunity_id, stage_id, stage_name, entered_at, left_at
    FROM opportunity_stage_history
  `;
  return rows.map((r) => ({
    opportunityId: Number(r.opportunity_id),
    stageId: Number(r.stage_id),
    stageName: r.stage_name,
    enteredAt: r.entered_at,
    leftAt: r.left_at,
  }));
}

export async function loadBrevoContacts(): Promise<BrevoContactRow[]> {
  // First-run safety: the brevo-sync may not have been wired up yet, so
  // create the table if it doesn't exist before reading. Mirrors the
  // pattern in app/lib/db.ts:upsertSwapRates.
  await sql`
    CREATE TABLE IF NOT EXISTS brevo_contacts (
      email             TEXT PRIMARY KEY,
      brevo_id          BIGINT,
      created_at        TIMESTAMPTZ,
      modified_at       TIMESTAMPTZ,
      attributes        JSONB NOT NULL DEFAULT '{}'::jsonb,
      list_ids          INTEGER[] NOT NULL DEFAULT '{}',
      synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  const { rows } = await sql<{
    email: string;
    brevo_id: number | string | null;
    created_at: string | null;
    modified_at: string | null;
    attributes: Record<string, unknown>;
    list_ids: number[] | null;
  }>`
    SELECT email, brevo_id, created_at, modified_at, attributes, list_ids
    FROM brevo_contacts
  `;
  return rows.map((r) => ({
    email: r.email,
    brevoId: r.brevo_id !== null ? Number(r.brevo_id) : null,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    attributes: r.attributes ?? {},
    listIds: r.list_ids ?? [],
  }));
}

export async function loadKsConversions(): Promise<KsConversionRow[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS ks_conversions (
      profile_id          TEXT PRIMARY KEY,
      name                TEXT,
      email               TEXT,
      mortgage_settled    DATE,
      ks_signed           DATE NOT NULL,
      notes               TEXT,
      synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  const { rows } = await sql<{
    profile_id: string;
    name: string | null;
    email: string | null;
    mortgage_settled: string | null;
    ks_signed: string;
  }>`
    SELECT profile_id, name, email, mortgage_settled, ks_signed
    FROM ks_conversions
  `;
  return rows.map((r) => ({
    profileId: r.profile_id,
    name: r.name,
    email: r.email,
    mortgageSettled: r.mortgage_settled,
    ksSigned: r.ks_signed,
  }));
}

// ----- targets -------------------------------------------------------------

export type StoredTargets = {
  current: SalesTargets;
  updatedBy: string | null;
  updatedAt: string | null;
};

export async function loadTargets(): Promise<StoredTargets> {
  await sql`
    CREATE TABLE IF NOT EXISTS sales_targets (
      id              INTEGER PRIMARY KEY DEFAULT 1,
      targets         JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by      TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT sales_targets_singleton CHECK (id = 1)
    )
  `;
  const { rows } = await sql<{
    targets: SalesTargets;
    updated_by: string | null;
    updated_at: string | null;
  }>`
    SELECT targets, updated_by, updated_at
    FROM sales_targets WHERE id = 1
  `;
  if (rows.length === 0) {
    return { current: {}, updatedBy: null, updatedAt: null };
  }
  return {
    current: rows[0].targets ?? {},
    updatedBy: rows[0].updated_by,
    updatedAt: rows[0].updated_at,
  };
}

export async function saveTargets(targets: SalesTargets, updatedBy: string): Promise<void> {
  await sql`
    INSERT INTO sales_targets (id, targets, updated_by, updated_at)
    VALUES (1, ${JSON.stringify(targets)}::jsonb, ${updatedBy}, NOW())
    ON CONFLICT (id) DO UPDATE
      SET targets    = EXCLUDED.targets,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
  `;
}

// ----- ks_conversions write (used by ks-conversions-sync.ts) ----------------

export async function upsertKsConversion(row: KsConversionRow): Promise<void> {
  await sql`
    INSERT INTO ks_conversions (profile_id, name, email, mortgage_settled, ks_signed, notes, synced_at)
    VALUES (${row.profileId}, ${row.name}, ${row.email}, ${row.mortgageSettled}, ${row.ksSigned}, ${''}, NOW())
    ON CONFLICT (profile_id) DO UPDATE
      SET name             = EXCLUDED.name,
          email            = EXCLUDED.email,
          mortgage_settled = EXCLUDED.mortgage_settled,
          ks_signed        = EXCLUDED.ks_signed,
          synced_at        = NOW()
  `;
}

/** Removes any ks_conversions rows whose profile_id is no longer in the source. */
export async function pruneKsConversions(keepIds: string[]): Promise<number> {
  if (keepIds.length === 0) {
    const { rowCount } = await sql`DELETE FROM ks_conversions`;
    return rowCount ?? 0;
  }
  // ANY($1::text[]) form
  const { rowCount } = await sql`
    DELETE FROM ks_conversions
    WHERE profile_id <> ALL(${keepIds as any})
  `;
  return rowCount ?? 0;
}

// ----- brevo write (used by brevo-sync.ts) ----------------------------------

export async function upsertBrevoContact(c: BrevoContactRow): Promise<void> {
  await sql`
    INSERT INTO brevo_contacts (email, brevo_id, created_at, modified_at, attributes, list_ids, synced_at)
    VALUES (
      ${c.email},
      ${c.brevoId},
      ${c.createdAt},
      ${c.modifiedAt},
      ${JSON.stringify(c.attributes)}::jsonb,
      ${c.listIds as any}::int[],
      NOW()
    )
    ON CONFLICT (email) DO UPDATE
      SET brevo_id    = EXCLUDED.brevo_id,
          created_at  = EXCLUDED.created_at,
          modified_at = EXCLUDED.modified_at,
          attributes  = EXCLUDED.attributes,
          list_ids    = EXCLUDED.list_ids,
          synced_at   = NOW()
  `;
}

export async function getBrevoWatermark(): Promise<string | null> {
  await sql`
    CREATE TABLE IF NOT EXISTS brevo_sync_runs (
      id              SERIAL PRIMARY KEY,
      started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at     TIMESTAMPTZ,
      status          TEXT NOT NULL DEFAULT 'running',
      contacts_seen   INTEGER NOT NULL DEFAULT 0,
      contacts_upsert INTEGER NOT NULL DEFAULT 0,
      watermark       TIMESTAMPTZ,
      error           TEXT
    )
  `;
  const { rows } = await sql<{ watermark: string | null }>`
    SELECT watermark FROM brevo_sync_runs
    WHERE status = 'done' AND watermark IS NOT NULL
    ORDER BY watermark DESC
    LIMIT 1
  `;
  return rows[0]?.watermark ?? null;
}

export async function startBrevoSyncRun(): Promise<number> {
  const { rows } = await sql<{ id: number }>`
    INSERT INTO brevo_sync_runs (status) VALUES ('running') RETURNING id
  `;
  return rows[0].id;
}

export async function finishBrevoSyncRun(
  id: number,
  status: 'done' | 'failed',
  contactsSeen: number,
  contactsUpsert: number,
  watermark: string | null,
  error: string | null,
): Promise<void> {
  await sql`
    UPDATE brevo_sync_runs
    SET finished_at     = NOW(),
        status          = ${status},
        contacts_seen   = ${contactsSeen},
        contacts_upsert = ${contactsUpsert},
        watermark       = ${watermark},
        error           = ${error}
    WHERE id = ${id}
  `;
}

// ----- digest archive ------------------------------------------------------

export type DigestArchiveRow = {
  cycleStart: string;
  cycleEnd: string;
  generatedAt: string;
  scorecard: unknown;
  markdown: string;
};

export async function saveDigest(row: DigestArchiveRow): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS sales_digests (
      cycle_start    DATE PRIMARY KEY,
      cycle_end      DATE NOT NULL,
      generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      scorecard      JSONB NOT NULL,
      markdown       TEXT NOT NULL
    )
  `;
  await sql`
    INSERT INTO sales_digests (cycle_start, cycle_end, generated_at, scorecard, markdown)
    VALUES (
      ${row.cycleStart}::date,
      ${row.cycleEnd}::date,
      ${row.generatedAt}::timestamptz,
      ${JSON.stringify(row.scorecard)}::jsonb,
      ${row.markdown}
    )
    ON CONFLICT (cycle_start) DO UPDATE
      SET cycle_end    = EXCLUDED.cycle_end,
          generated_at = EXCLUDED.generated_at,
          scorecard    = EXCLUDED.scorecard,
          markdown     = EXCLUDED.markdown
  `;
}

export async function loadLatestDigest(): Promise<DigestArchiveRow | null> {
  await sql`
    CREATE TABLE IF NOT EXISTS sales_digests (
      cycle_start    DATE PRIMARY KEY,
      cycle_end      DATE NOT NULL,
      generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      scorecard      JSONB NOT NULL,
      markdown       TEXT NOT NULL
    )
  `;
  const { rows } = await sql<{
    cycle_start: string;
    cycle_end: string;
    generated_at: string;
    scorecard: unknown;
    markdown: string;
  }>`
    SELECT cycle_start, cycle_end, generated_at, scorecard, markdown
    FROM sales_digests
    ORDER BY generated_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    cycleStart: r.cycle_start,
    cycleEnd: r.cycle_end,
    generatedAt: r.generated_at,
    scorecard: r.scorecard,
    markdown: r.markdown,
  };
}
