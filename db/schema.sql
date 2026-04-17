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
