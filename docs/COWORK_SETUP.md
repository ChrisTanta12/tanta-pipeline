# Cowork setup — Tanta Finance

How Chris and Anthony wire Cowork on their machines to ask conversational questions
against Tanta-Finance data. Cowork reads the snapshot exported by the Vercel app —
it doesn't connect to Postgres directly (read-only by design, avoids race conditions).

## Architecture

```
Vercel app (this repo)
   │ npm run finance:snapshot
   ▼
Google Drive shared folder
   │  (Drive Desktop syncs to local fs)
   ▼
~/Tanta-Finance/snapshot/tanta_finance_snapshot.json
   │  + Tanta-Finance/ skill files (also synced)
   ▼
Cowork (Claude Desktop) reads both
```

## One-time setup per machine (Chris and Anthony)

### 1. Install Google Drive Desktop
- Download from https://www.google.com/drive/download/
- Sign in with your Tanta workspace account
- Open Drive preferences → Folders from Drive → mark the **Tanta-Finance** folder
  as **Available offline**. Cowork reads from local disk; Drive-browser-only doesn't work.

### 2. Confirm folder structure under Drive
The shared Drive folder should look like this. Both Chris and Anthony see the same
contents, but each has their own local copy.

```
Tanta-Finance/                    ← shared Drive folder
├── README.md
├── tanta_fortnightly_workflow.md
├── shared/                       ← TAPs, account map, business context, etc.
├── bookkeeping/
├── analysis/
├── reporting/
├── control/
├── forecasting/
├── integrations/
├── inputs/                       ← bank statements, KAN xlsx, SHL CSVs
├── reports/                      ← generated HTML dashboards
└── snapshot/                     ← ← THIS PR adds this folder
    └── tanta_finance_snapshot.json
```

The skill files (`shared/`, `bookkeeping/`, etc.) already exist in Chris's Claude Home
Base. Moving them to the shared Drive folder is the only structural change — content
stays identical.

### 3. Install Claude Desktop with Cowork
- https://claude.ai/download (Mac and Windows)
- Sign in with your individual Anthropic account (Chris and Anthony each use their own)
- Enable Cowork in settings

### 4. Point Cowork at the Tanta-Finance folder
- Cowork → Workspace → Add folder → select the local Drive-synced `Tanta-Finance/`
- Cowork will index the skill files; the snapshot file refreshes automatically each time
  the Vercel app exports a new one

## How Vercel writes the snapshot

The cycle-close flow in the Vercel app calls `npm run finance:snapshot`, which writes
`tanta_finance_snapshot.json` to whatever path `FINANCE_SNAPSHOT_PATH` resolves to.

Two ways to wire that path:

**Option A — Office PC writer (recommended)**: the office PC already runs `npm run trail:sync`
on a schedule. Add a sibling cron task that runs `npm run finance:snapshot` after each cycle
close. Set `FINANCE_SNAPSHOT_PATH` to the local path of the Drive-synced folder. Drive Desktop
syncs the file out to all linked machines automatically.

**Option B — Vercel writer to Drive API**: Vercel function calls the Drive API directly to
upload the snapshot file. More setup (OAuth + service account), but doesn't depend on the
office PC being on. Worth it later, not for v1.

Default for v1 is **Option A** — same office-PC proxy pattern Trail sync already uses.

## Asking Cowork questions

Once set up, both principals can open Cowork on their machine and ask things like:

- "Walk me through the latest cycle"
- "Why did Opex spike on the 25/2 cycle?"
- "What's worth flagging this fortnight?"
- "Model what happens if we drop the Salaries TAP to 40% next quarter"
- "Compare this quarter's trail income to last quarter"

Cowork reads:
- The snapshot file for current data + recent history
- The skill files in `shared/`, `analysis/`, `control/` for how to think about Tanta's finances
- The `forecasting/` skills for scenario modelling

## What Cowork CANNOT do (by design)

- **Cannot write back to Postgres.** Snapshot is read-only. Insights from Cowork sessions
  get pasted back into the Vercel app's notes field on a cycle, not directly to the DB.
- **Cannot run while Claude Desktop is closed.** Cowork is a desktop tool. The Vercel app
  is the always-on surface; Cowork is the conversational add-on.
- **Cannot share session state between Chris and Anthony.** Each runs their own Cowork.
  The snapshot they both read is shared; the conversations they have aren't.

## Privacy considerations

The snapshot includes:
- Cycle income totals, allocation amounts, expense category totals
- Account balances at cycle close
- Capital movement amounts and counterparties
- Pre-computed flags

It does NOT include:
- Per-transaction line items (those stay in the bank-statement CSVs in `inputs/`)
- Client identifiable data (no client names, no client IDs)
- Trail pipeline data (Cowork can be asked to analyse pipeline by reading the local CSVs
  in `inputs/`, but the snapshot itself stays clean)

When the Trail integration lands later, follow the architecture memo's recommendation:
strip names to client IDs in any snapshot, keep the lookup table local.
