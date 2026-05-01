# /finance route — architecture & runbook

Auth-gated dashboard for Tanta's fortnightly Profit First overlay + cycle reporting.
Designed alongside the existing `Tanta-Finance/` workflow folder in Chris's Claude Home Base
(skills folder). The Vercel app is the **canonical data store**; Cowork sessions read a
JSON snapshot exported from Postgres. Same skill files drive both surfaces.

## Quick mental model

```
Bank statements / KAN xlsx / SHL CSVs
                │ (cycle close)
                ▼
        finance_cycles + finance_capital_movements (Postgres)
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
   /finance page   tanta_finance_snapshot.json
   (this app)      (Drive folder, read by Cowork)
```

## Files in this PR

| Path | Purpose |
|---|---|
| `db/schema.sql` (additions) | New tables: `finance_cycles`, `finance_config`, `finance_capital_movements` |
| `app/lib/finance-types.ts` | TypeScript types for cycles + config + capital + snapshot |
| `app/lib/finance-db.ts` | Read helpers (getRecentCycles, getCurrentConfig, etc.) |
| `app/lib/finance-auth.ts` | Server-side cookie verification (HMAC-signed) |
| `app/api/finance-unlock/route.ts` | POST PIN → sets HttpOnly signed cookie. DELETE clears. |
| `app/api/finance-data/route.ts` | GET (auth-gated) → cycles + config + capital + aggregates |
| `app/finance/page.tsx` | The dashboard (PIN gate + allocations-top design) |
| `scripts/seed-finance.ts` | Seed Q1 2026 baseline cycles. `npm run finance:seed` |
| `scripts/finance-snapshot.ts` | Export Postgres → JSON file for Cowork. `npm run finance:snapshot` |
| `docs/FINANCE_ROUTE.md` | This file |
| `docs/COWORK_SETUP.md` | How Chris + Anthony wire Cowork to read the snapshot |

## Auth — interim, not production

The PIN gate uses an HMAC-signed HttpOnly cookie. This is **better than the existing
`/api/exec-check` localStorage-only pattern** (which is UI cosmetics — anyone can call
the underlying APIs directly), because `/api/finance-data` validates the cookie
server-side on every request.

**It is still not production-grade auth for FAP-licensed financial data.** Known limitations:

- No per-user identity (anyone with the PIN gets in)
- No rate limiting on PIN attempts
- No audit log of access events
- 8-hour cookie lifetime, no remote revoke

Upgrade path: replace `/api/finance-unlock` + `app/lib/finance-auth.ts` with NextAuth
(email magic link) or Clerk before this dashboard is shared widely. The skill files in
`Tanta-Finance/` reference this constraint and the architecture memo (`memory/project_tanta_finance_architecture.md`) explicitly excludes PIN auth from the long-term picture.

## Required env vars

| Var | Required | Default | What it does |
|---|---|---|---|
| `FINANCE_PIN` | recommended | falls back to `EXEC_PIN` | The PIN that unlocks `/finance` |
| `FINANCE_COOKIE_SECRET` | recommended | falls back to `EXEC_PIN` | HMAC key for signing the auth cookie. **Set this to a random string in Vercel** before merging — using the PIN as the HMAC key is a weak fallback that exists only so dev environments work out of the box. |
| `FINANCE_SNAPSHOT_PATH` | snapshot script only | `cwd` | Where `npm run finance:snapshot` writes the JSON file. In production: a Drive-synced folder. |

## Migration

The schema additions are idempotent (`CREATE TABLE IF NOT EXISTS`, etc.) and don't touch
existing tables. To apply:

```bash
npm run db:migrate
npm run finance:seed       # populates Q1 2026 baseline (6 cycles)
npm run finance:snapshot   # writes tanta_finance_snapshot.json
```

The migrate is safe to run repeatedly. `finance:seed` uses `ON CONFLICT` for cycles
and `DELETE`+re-insert for capital movements within the seeded date range, so re-running
refines existing rows rather than duplicating.

## Local dev

```bash
git checkout feature/finance-route
npm install
# .env.local needs POSTGRES_URL, FINANCE_PIN, FINANCE_COOKIE_SECRET
npm run db:migrate
npm run finance:seed
npm run dev
# open http://localhost:3000/finance, enter PIN
```

## What's intentionally NOT in this PR

- **Charts** — the seeded data renders as KPIs + tables. Charts (Chart.js mirror of the
  HTML mockups in `Tanta-Finance/reports/`) are the next iteration once the data shape
  is validated.
- **Cycle ingest from CSVs** — currently cycles land via `seed-finance.ts` with hardcoded
  values. The next iteration adds an ingestion endpoint that reads bank-statement CSVs
  and produces a cycle row, mirroring `Tanta-Finance/inputs/categorize.mjs`.
- **Real auth** — see "Auth — interim" above.
- **Trail integration into the dashboard** — the pipeline forecast section uses Trail
  data via existing `/api/opportunities`; that wire-in is its own iteration.

## Design principles (locked)

These are baked into the page intentionally. See `Claude Home Base/Tanta-Finance/`
for full context.

1. **Allocations stay as the top line.** This is operational/action artefact, not
   a strategic dashboard. Chris reads runway instinctively from being in the business
   daily — surfacing it explicitly would make the report read-for-someone-else.
2. **Drawings ≠ salaries.** Always display as "drawings" or "drawings (shareholder
   loan repayments)". Never "salaries" or "owner compensation". They're tax-free
   loan principal repayments, not income to the principals.
3. **Drawings split 50/50** between Chris and Anthony, always. Brothers, different roles,
   equal compensation. Locked policy 1 May 2026.
4. **Capital movements are explicit and separate** from trading income. Asset sales
   (Halo book purchase), contractor pass-throughs (Aaron / Luke), reserve top-ups —
   all live in `finance_capital_movements`, never folded into the income figure.
5. **TAPs are reviewed quarterly.** Drift between quarters is normal and intentional.
   `finance_config` is versioned; historical cycles still reference their effective
   config so retrospective math stays accurate when TAPs change.
6. **The fortnightly cadence drives every other Wednesday's catch-up.** Intermediate
   Wednesdays are general business / project check-ins — different agenda, not this
   workflow's job.
