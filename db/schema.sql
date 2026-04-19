-- Bank rates dashboard schema
-- Single JSONB blob per bank keeps the shape flexible as fields evolve.

CREATE TABLE IF NOT EXISTS banks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_log (
  id                  SERIAL PRIMARY KEY,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  bank_id             TEXT,
  gmail_message_id    TEXT,
  gmail_subject       TEXT,
  gmail_date          TIMESTAMPTZ,
  parser              TEXT,        -- 'text' | 'vision' | 'manual'
  status              TEXT,        -- 'success' | 'partial' | 'failed' | 'needs_review'
  changes             JSONB,       -- diff of what changed
  error               TEXT,
  needs_review        BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS ingestion_log_recent ON ingestion_log (started_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_log_review ON ingestion_log (needs_review) WHERE needs_review = TRUE;

-- Tracks which Gmail messages we've already processed so the cron job is idempotent.
CREATE TABLE IF NOT EXISTS processed_emails (
  gmail_message_id  TEXT PRIMARY KEY,
  bank_id           TEXT,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cache of Trail CRM entities (opportunities, pipelines) kept in sync by the
-- office-side trail-sync script. Vercel routes read from here instead of
-- calling Trail directly, so Trail's IP whitelist only needs the office IP.
CREATE TABLE IF NOT EXISTS trail_entities (
  kind         TEXT   NOT NULL,     -- 'opportunity' | 'pipeline'
  entity_id    BIGINT NOT NULL,
  data         JSONB  NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, entity_id)
);

CREATE INDEX IF NOT EXISTS trail_entities_kind ON trail_entities (kind);

-- Queue of sync jobs. The script running on the office PC polls this table
-- every couple of minutes and runs a full sync whenever there's a pending row.
CREATE TABLE IF NOT EXISTS trail_sync_jobs (
  id             SERIAL PRIMARY KEY,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'pending',    -- pending | running | done | failed
  requested_by   TEXT,                                -- 'schedule' | 'manual' | 'startup'
  opportunities  INTEGER,
  pipelines      INTEGER,
  error          TEXT
);

CREATE INDEX IF NOT EXISTS trail_sync_jobs_pending ON trail_sync_jobs (status, requested_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS trail_sync_jobs_recent ON trail_sync_jobs (requested_at DESC);

-- Full stage-history log per opportunity. One row per stage "visit".
-- Trail's API doesn't expose when a deal entered its current stage (modifiedTimestamp
-- resets on ANY edit), so we track it ourselves during sync.
--
-- Semantics:
--   entered_at    — when the opp entered this stage
--   left_at       — when the opp left the stage; NULL = currently in this stage
--
-- If a deal moves Stage A → B → back to A, you get THREE rows:
--   row 1: stage A, entered=T0, left=T1
--   row 2: stage B, entered=T1, left=T2
--   row 3: stage A, entered=T2, left=NULL   ← current
-- "Days in current stage A" = row1 duration + row3 duration (cumulative).
CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  opportunity_id  BIGINT NOT NULL,
  stage_id        BIGINT NOT NULL,
  stage_name      TEXT,
  entered_at      TIMESTAMPTZ NOT NULL,
  left_at         TIMESTAMPTZ,
  PRIMARY KEY (opportunity_id, entered_at)
);

-- Fast lookup of "what stage is this opp currently in" and "when did it enter".
CREATE INDEX IF NOT EXISTS opportunity_stage_history_current
  ON opportunity_stage_history (opportunity_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS opportunity_stage_history_stage
  ON opportunity_stage_history (opportunity_id, stage_id);
