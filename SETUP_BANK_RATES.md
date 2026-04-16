# Bank Rates Dashboard — setup

Adds `/lenders` to the tanta-pipeline site. Daily cron pulls rate/turnaround/traffic-light
updates from Gmail (`Bank Updates/*` labels) and writes them into Postgres.

## 1. Provision Postgres

In the Vercel dashboard for **tanta-pipeline**:

1. Storage → Create → **Postgres** (Hobby tier is fine).
2. Connect it to the project — this auto-sets `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, etc.
3. Pull env vars locally so the migrate/seed scripts can reach the DB:
   ```bash
   npx vercel link
   npx vercel env pull .env.local
   ```

## 2. Create the schema & seed

```bash
cd C:/Users/chris/Documents/tanta-pipeline
npm install
npm run db:migrate
npm run db:seed
```

After this, deploy (or `npm run dev`) and open `/lenders` — you should see the current
spreadsheet values as the baseline.

## 3. Gmail OAuth (read-only)

The cron endpoint needs to read Gmail.

1. Google Cloud Console → create a project (or reuse one).
2. **Enable the Gmail API** for the project.
3. **OAuth consent screen**: type **External**, add `chris@tanta.co.nz` as a test user,
   scopes: `gmail.readonly`.
4. **Credentials → Create OAuth 2.0 Client ID** (type: **Web application**).
   Authorised redirect URI: `http://localhost:3000/oauth2callback`.
5. Generate a refresh token locally:
   ```bash
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run oauth:setup
   ```
   Follow the URL, consent, copy the printed refresh token.

## 4. Set Vercel env vars

In Vercel → tanta-pipeline → Settings → Environment Variables (all envs):

| Name                    | Value                                        |
|-------------------------|----------------------------------------------|
| `GOOGLE_CLIENT_ID`      | from step 3                                  |
| `GOOGLE_CLIENT_SECRET`  | from step 3                                  |
| `GOOGLE_REFRESH_TOKEN`  | printed by `oauth:setup`                     |
| `ANTHROPIC_API_KEY`     | from console.anthropic.com → API Keys        |
| `CRON_SECRET`           | any random 32-char string — protects the cron endpoint |

## 5. Cron schedule

`vercel.json` runs `/api/ingest-bank-updates` daily at **19:00 UTC** = 07:00 NZST.
During NZ daylight saving (Sep-Apr) this fires at 08:00 NZDT; adjust the cron or leave as-is.

To trigger manually:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://tanta-pipeline.vercel.app/api/ingest-bank-updates
```

## How parsing works

| Bank      | Text parser extracts                     | Vision parser fills in            |
|-----------|------------------------------------------|-----------------------------------|
| ASB       | rate card, service rate, turnaround, cashback | —                              |
| BNZ       | turnaround, cashback text                | rate card (images)                |
| ANZ       | effective date                           | rate card, traffic lights (images)|
| Westpac   | effective date                           | rate card (images)                |
| Kiwibank  | matrix validity date                     | rate matrix, traffic lights       |

Vision parsing uses Claude Opus 4.7. Anything the model flags with low confidence is stored
but `needs_review=true` is logged in `ingestion_log`, so you can audit from the dashboard
or the table directly.

## Troubleshooting

- **Cron hits but nothing changes**: check `ingestion_log` — every run writes a row per
  bank even when no new email exists.
- **`Unauthorized` on cron endpoint**: the Vercel cron only includes `Authorization: Bearer CRON_SECRET` when the env var is set. Make sure it's set on **Production**.
- **Gmail 401**: refresh token expired (Google revokes after 7 days if the app is still in
  "Testing" state — move the OAuth consent to "In production" once you're happy).
- **Vision returns garbage**: check `ingestion_log.changes` — raw model output is there.
  You can manually fix values by editing the JSONB in the `banks` table.
