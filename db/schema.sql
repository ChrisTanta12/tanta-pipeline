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
