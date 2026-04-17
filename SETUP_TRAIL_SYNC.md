# Trail → Postgres sync (office PC)

The Trail API only accepts calls from the office's whitelisted IP. Vercel's
functions don't share that IP, so instead of calling Trail from Vercel we run
a small sync script on the office PC — it calls Trail (from the whitelisted
IP) and writes opportunities + pipelines into Postgres. Vercel then reads
from Postgres.

```
Trail API ──(office IP, whitelisted)──▶ trail-sync.ts on office PC ──▶ Neon Postgres
                                                                         │
                                       Vercel ──(reads)───────────────────┘
```

## 1. Install the DB schema additions

Pull the branch and run the migration once — it adds `trail_entities` and
`trail_sync_jobs` tables (existing tables are left alone via `IF NOT EXISTS`).

```bash
cd C:/Users/chris/Documents/tanta-pipeline
git pull
npm install
npm run db:migrate
```

## 2. Make sure the env vars are set locally

`.env.local` needs `POSTGRES_URL`, `TRAIL_API_KEY`, and optionally
`TRAIL_BASE_URL`. `vercel env pull .env.local` fetches the first; you add
`TRAIL_API_KEY` yourself (same value you set in Vercel).

Open `.env.local` in a text editor and append:
```
TRAIL_API_KEY=<your-trail-api-key>
TRAIL_BASE_URL=https://beta.api.gettrail.com/api/v1
```

## 3. Test the sync manually

```bash
npm run trail:sync
```

Expected output:
```
[trail-sync] starting scheduled sync, job 1
[trail-sync]   page 1: 500 records (500/1204)
[trail-sync]   page 2: 500 records (1000/1204)
[trail-sync]   page 3: 204 records (1204/1204)
[trail-sync] ✓ done — 1204 opportunities, 6 pipelines
```

If it's green, open `https://tanta-pipeline.vercel.app/` — the pipeline
dashboard should now show live data. Click **Sync from Trail** in the top bar,
wait ~2 minutes, and watch it re-sync.

## 4. Schedule it to run automatically

Two Task Scheduler entries: a daily 4pm full sync, and a lightweight every-2-min
poller that only runs if the dashboard has queued an on-demand sync.

### 4a. Daily 4pm sync

1. Open **Task Scheduler** (Win key → type *task scheduler*).
2. Right-hand pane → **Create Task…** (not "Create Basic Task" — we need the
   advanced options).
3. **General** tab:
   - Name: `Tanta — Trail Sync (Daily 4pm)`
   - Description: `Pulls opportunities + pipelines from Trail into Postgres`
   - Security options:
     - Select **Run whether user is logged on or not** (so it fires even
       when you're logged off or another account is active).
     - Tick **Do not store password** (works because the script only reads
       local files — no network logon needed).
   - Configure for: **Windows 10**.
4. **Triggers** tab → **New…**:
   - Begin the task: **On a schedule**
   - Settings: **Daily**, start at **16:00:00**, recur every **1 days**.
   - Tick **Enabled**, leave the rest default.
5. **Actions** tab → **New…**:
   - Action: **Start a program**
   - Program/script: `C:\Program Files\nodejs\npm.cmd`
   - Add arguments: `run trail:sync`
   - Start in: `C:\Users\chris\Documents\tanta-pipeline`
6. **Conditions** tab:
   - **Untick** "Start the task only if the computer is on AC power" (so it
     runs on battery too).
   - Tick **Wake the computer to run this task** if you want it to fire even
     when the PC is asleep at 4pm.
7. **Settings** tab:
   - Tick **Run task as soon as possible after a scheduled start is missed**
     (so if the PC was off at 4pm, it catches up as soon as you turn it on).
   - Tick **If the task fails, restart every: 5 minutes, attempt up to 3 times**.
8. **OK** → it'll prompt for the account password for the "Run whether logged
   on or not" mode.

### 4b. Every-2-min on-demand check

Same wizard with different values:

1. **Create Task…**
2. **General**:
   - Name: `Tanta — Trail Sync (On-demand check)`
   - **Run only when user is logged on** (fine for this — this is the dashboard
     button handler, which requires your PC to be awake anyway).
3. **Triggers** → **New…**:
   - Begin: **On a schedule**
   - **Daily**, start at today's date at 00:01:00
   - **Repeat task every: 2 minutes for a duration of 1 day**
   - Tick **Enabled**.
4. **Actions** → **New…**:
   - Program/script: `C:\Program Files\nodejs\npm.cmd`
   - Add arguments: `run trail:sync -- --check`
   - Start in: `C:\Users\chris\Documents\tanta-pipeline`
5. **Settings**:
   - Tick **If the task is already running, the following rule applies**:
     **Do not start a new instance** (prevents pile-ups).
6. **OK**.

The `--check` mode exits in under a second if there's nothing pending, so
running it every 2 minutes is cheap.

## 5. Verify

Back on the dashboard:

1. Click the **Sync from Trail** button in the top bar.
2. Within 2 minutes the button should turn yellow with "Syncing from office
   PC..." and then back to default with a tooltip showing the last-synced time.
3. Confirm the numbers on the dashboard update.

## Troubleshooting

- **"TRAIL_API_KEY is not set"** — you haven't added it to `.env.local`
  (Task Scheduler runs the npm script from the repo, which loads `.env.local`
  via the `--env-file` flag in `package.json`).
- **"POSTGRES_URL is not set"** — run `npx vercel env pull .env.local`
  again; the Postgres vars need to be in there.
- **Task Scheduler says "The task image is corrupt"** — usually a path issue.
  Make sure `C:\Program Files\nodejs\npm.cmd` exists. If Node is installed
  elsewhere, run `where npm` in a terminal to find the correct path.
- **Dashboard still shows 403** — production still has the old Trail-
  proxying code, or the DB doesn't have any records yet. Re-check:
  - Vercel redeployed with the new code (look at the latest deployment SHA)
  - `npm run trail:sync` ran successfully at least once
  - The `trail_entities` table has rows (check in Neon console → SQL editor).

## Operational notes

- If you rotate the Trail API key, update it both in Vercel env vars and in
  your local `.env.local`.
- Sync history is in `trail_sync_jobs` — query the last 20:
  ```sql
  SELECT id, requested_at, status, requested_by, opportunities, pipelines, error
  FROM trail_sync_jobs ORDER BY id DESC LIMIT 20;
  ```
- To manually clear/rebuild the cache (e.g. after Trail schema changes):
  ```sql
  TRUNCATE trail_entities;
  ```
  then `npm run trail:sync` locally.
