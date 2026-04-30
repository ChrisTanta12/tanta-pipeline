# Swap-rate sync setup

The break fee calculator at `/break-fee` reads from the `swap_rates`
Postgres table, populated by `scripts/scrape-swap-rates.ts`.

The script downloads the **RBNZ B2 daily close** XLSX
(<https://www.rbnz.govt.nz/-/media/project/sites/rbnz/files/statistics/series/b/b2/hb2-daily-close.xlsx>),
parses the latest swap rate row (1y/2y/3y/4y/5y/7y/10y), and upserts
it into Postgres. Vercel routes never call RBNZ directly because RBNZ's
edge blocks AWS datacenter IPs with 403.

## One-time office-PC setup

Same machine that already runs `npm run trail:sync` daily.

### 1. Confirm the repo path

The VBS launcher assumes the repo lives at:

```
C:\Users\chris\Documents\tanta-pipeline
```

If different, edit `ROOT_PATH` at the top of
`scripts/scrape-swap-rates.vbs`.

### 2. Test the script manually

```bash
cd C:\Users\chris\Documents\tanta-pipeline
npm run scrape:swap-rates
```

You should see:

```
[scrape:swap-rates] fetching RBNZ B2 daily close…
[scrape:swap-rates] observation 2026-04-29, terms 1y, 2y, 3y, 4y, 5y, 7y, 10y
[scrape:swap-rates] upsert complete
```

### 3. Test the hidden-window launcher

Double-click `scripts\scrape-swap-rates.vbs` from File Explorer.

- No window should appear.
- A new entry stamped with the current time appears in
  `scripts\swap-rates.log`.

### 4. Schedule it

Open **Task Scheduler** → **Create Task...** (not "Create Basic Task" —
we want the full options).

- **General**
  - Name: `Tanta Swap Rate Sync`
  - "Run whether user is logged on or not"
  - "Run with highest privileges" (only if your environment needs it; not
    usually required for outbound HTTP + DB writes)
- **Triggers** → New
  - Daily, start at `08:30:00`
  - This is after RBNZ's overnight publication of the previous day's
    close. If you'd rather have it before the office opens, `07:30` is
    also fine — RBNZ usually has the file up by then.
- **Actions** → New
  - Action: **Start a program**
  - Program/script: `wscript.exe`
  - Add arguments: `"C:\Users\chris\Documents\tanta-pipeline\scripts\scrape-swap-rates.vbs"`
- **Conditions** → uncheck "Start the task only if the computer is on AC
  power" (laptop case).
- **Settings** → tick "If the running task does not end when requested,
  force it to stop", and set "Stop the task if it runs longer than" to
  10 minutes.

Save. Right-click the task → **Run** to verify. Within ~30 s the log
should record a successful sync. No window will appear.

## Troubleshooting

### Log file says `403 RBNZ B2 returned 403`

Means your office IP is also blocked (rare). Confirm with:

```bash
curl -I -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  https://www.rbnz.govt.nz/-/media/project/sites/rbnz/files/statistics/series/b/b2/hb2-daily-close.xlsx
```

If that returns 403, fall back to running the scraper from a personal
machine on a different network.

### Log file says `POSTGRES_URL is not set`

`.env.local` isn't being loaded. Check it exists in the repo root and
contains `POSTGRES_URL=...`.

### `/api/swap-rates` still returns 404 in the dashboard

The cron has never written a row. Check:

```bash
psql "$POSTGRES_URL" -c "SELECT observation_date, fetched_at FROM swap_rates ORDER BY observation_date DESC LIMIT 3;"
```

If empty, run `npm run scrape:swap-rates` manually and re-check.

### Calculator banner says "Couldn't load live rates"

Either the table is empty or the route is erroring. Visit
`/api/swap-rates` directly — should return JSON like:

```json
{
  "observationDate": "2026-04-29",
  "rates": { "1y": 3.16, "2y": 3.54, ... },
  "source": "https://www.rbnz.govt.nz/.../hb2-daily-close.xlsx",
  "fetchedAt": "..."
}
```
