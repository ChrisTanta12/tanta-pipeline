-- Bank rates dashboard schema
-- Single JSONB blob per bank keeps the shape flexible as fields evolve.

CREATE TABLE IF NOT EXISTS banks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Carded rates scraped from interest.co.nz/borrowing. Kept in a separate
-- column so the broker-email ingest (which writes to data) can never clobber
-- the carded reference, and vice versa. Populated by /api/scrape-interest.
ALTER TABLE banks ADD COLUMN IF NOT EXISTS carded_data JSONB;
ALTER TABLE banks ADD COLUMN IF NOT EXISTS carded_updated_at TIMESTAMPTZ;

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

-- Cached client profile data from Trail. Sync pulls /profiles?page=... in bulk
-- on each run. We denormalise profile_rank and profile_status for fast JOINs
-- in the /api/opportunities read path, and keep the full profile body in
-- `data` for anything else we might need later (contacts, profileSource, etc.).
CREATE TABLE IF NOT EXISTS trail_profiles (
  profile_id        TEXT PRIMARY KEY,
  profile_rank      TEXT,
  profile_status    TEXT,
  data              JSONB,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trail_profiles_rank   ON trail_profiles (profile_rank);
CREATE INDEX IF NOT EXISTS trail_profiles_status ON trail_profiles (profile_status);

-- One-time seed of ANZ turnaround values (published only on ANZ's auth-gated
-- broker portal, so the email-ingest pipeline can't pick them up). Seeded as
-- `source: 'manual'` so the db-write shim in mergeBankData will preserve them
-- against future auto ingests. The `turnaround_seeded` marker key prevents
-- re-seeding when the migration runs again — an admin who later edits via the
-- TAT override UI won't have their values clobbered.
UPDATE banks
SET data = data
  || jsonb_build_object(
    'turnaround', jsonb_build_object(
      'Priority Assessment – Retail',   jsonb_build_object('days', 2, 'updatedAt', '2026-04-21T00:00:00.000Z', 'source', 'manual'),
      'Priority Assessment – Business', jsonb_build_object('days', 2, 'updatedAt', '2026-04-21T00:00:00.000Z', 'source', 'manual'),
      'Reassessment',                   jsonb_build_object('days', 2, 'updatedAt', '2026-04-21T00:00:00.000Z', 'source', 'manual'),
      'Other Assessment – Retail',      jsonb_build_object('days', 4, 'updatedAt', '2026-04-21T00:00:00.000Z', 'source', 'manual'),
      'Other Assessment – Business',    jsonb_build_object('days', 4, 'updatedAt', '2026-04-21T00:00:00.000Z', 'source', 'manual'),
      'Loan Maintenance',               jsonb_build_object('days', 3, 'updatedAt', '2026-04-21T00:00:00.000Z', 'source', 'manual'),
      'Loan Structures & Documents',    jsonb_build_object('days', 1, 'updatedAt', '2026-04-21T00:00:00.000Z', 'source', 'manual')
    ),
    'turnaround_seeded', true
  )
WHERE id = 'anz' AND NOT (data ? 'turnaround_seeded');

-- Wholesale swap rates scraped from interest.co.nz/charts/interest-rates/swap-rates
-- One row per observation_date. We always read the most recent row, but
-- keeping history lets us look up the swap rate at the time a client fixed.
-- Populated by /api/scrape-swap-rates (cron, daily).
CREATE TABLE IF NOT EXISTS swap_rates (
  observation_date  DATE PRIMARY KEY,
  rates             JSONB NOT NULL,        -- { "1y": 4.12, "2y": 4.05, ... }
  source            TEXT NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS swap_rates_observation_date_desc ON swap_rates (observation_date DESC);


-- =====================================================
-- /finance route — Profit First overlay + cycle reporting
-- Backs the auth-gated /finance page Chris uses for fortnightly + quarterly
-- catch-ups with Anthony. Also feeds the snapshot.json that Cowork sessions
-- read for conversational analysis (see scripts/finance-snapshot.ts).
-- =====================================================

-- One row per fortnightly cycle. The cycle ends on the allocation date.
-- Cycle data is mostly summary rollups; raw transaction-level data stays in
-- the bank statement CSVs in the Tanta-Finance/inputs folder for now.
CREATE TABLE IF NOT EXISTS finance_cycles (
  cycle_end_date          DATE PRIMARY KEY,
  cycle_start_date        DATE NOT NULL,
  quarter                 TEXT NOT NULL,                         -- e.g. '2026Q1'

  -- Trading income (mortgage commission + recurring trail).
  -- Cash basis = what hit Tanta Income this cycle.
  -- Earned basis = what KAN/SHL etc. invoiced for this cycle (may differ by lag).
  trading_income_cash     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  trading_income_earned   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  trail_income            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  upfront_income          NUMERIC(12, 2) NOT NULL DEFAULT 0,

  -- Per-source breakdown: { "KAN": {trail, upfront, refix, clawback}, "SHL": {trail, upfront}, "Booster": {trail}, ... }
  income_by_source        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Profit First allocations.
  -- prescribed = what the live TAPs would dictate.
  -- actual = what bank rules actually transferred.
  -- Drift between the two is the "TAP execution drift" Controller flag.
  allocations_prescribed  JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { opex, salaries, tax, profit }
  allocations_actual      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- True operating Opex outflow this cycle (rent + SaaS via CC + GST + insurance + ...).
  -- EXCLUDES drawings, inter-account transfers, and capital deployments.
  true_opex               NUMERIC(12, 2) NOT NULL DEFAULT 0,
  opex_by_category        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { rent, saas, insurance, gst, ... }

  -- Drawings split 50/50 by policy. Stored separately so historical changes
  -- can be detected / explained.
  drawings_chris          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  drawings_anthony        NUMERIC(12, 2) NOT NULL DEFAULT 0,

  -- Account balances at cycle close. Snapshot for variance tracking.
  -- { "Tanta Income": 18968.70, "Opex 8.1K": 7791.06, "Tax (external)": 6818.41, ... }
  account_balances_end    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Pre-computed flags from the analyst phase. Each entry: { severity, title, body }.
  flags                   JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Free-text notes Chris/Anthony want to capture against this cycle.
  notes                   TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS finance_cycles_quarter ON finance_cycles (quarter);
CREATE INDEX IF NOT EXISTS finance_cycles_recent  ON finance_cycles (cycle_end_date DESC);

-- TAPs and account map, versioned. Insert a new row when TAPs change at the
-- quarterly review. Historical cycles still reference their effective config
-- by date so retrospective math stays accurate after a TAP change.
CREATE TABLE IF NOT EXISTS finance_config (
  id              SERIAL PRIMARY KEY,
  effective_from  DATE NOT NULL,
  effective_to    DATE,                                          -- NULL = current row
  taps            JSONB NOT NULL,                                -- { opex, salaries, tax, profit }
  account_map     JSONB NOT NULL,                                -- { "Tanta Income": "...", ... }
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS finance_config_current
  ON finance_config (effective_from DESC) WHERE effective_to IS NULL;

-- Capital movements are explicitly separate from trading income to prevent
-- accidentally rolling them into PF allocation math. Asset sales (Halo book
-- purchase), contractor pass-throughs (Aaron wash-up), reserve top-ups,
-- principal loan repayments etc. all live here.
CREATE TABLE IF NOT EXISTS finance_capital_movements (
  id              SERIAL PRIMARY KEY,
  movement_date   DATE NOT NULL,
  cycle_end_date  DATE REFERENCES finance_cycles(cycle_end_date) ON DELETE SET NULL,
  kind            TEXT NOT NULL,                                 -- asset_sale | contractor_passthrough | reserve_topup | loan_principal | etc.
  amount          NUMERIC(12, 2) NOT NULL,                       -- positive = inflow, negative = outflow
  description     TEXT,
  payee_or_payer  TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS finance_capital_movements_date  ON finance_capital_movements (movement_date DESC);
CREATE INDEX IF NOT EXISTS finance_capital_movements_cycle ON finance_capital_movements (cycle_end_date);
