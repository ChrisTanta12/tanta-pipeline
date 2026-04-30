# Tanta Pipeline — Handoff

Read this first if you've been added as a collaborator. After this, read **[../CLAUDE.md](../CLAUDE.md)** for the hard rules, then your task brief in `docs/TASKS/`.

## 1. What this is

`tanta-pipeline` is **Tanta's internal mortgage pipeline dashboard.** It pulls
data from **Trail CRM** (the source of truth for adviser deals) and from
**interest.co.nz** (bank rate scraping), stores it in **Vercel Postgres**, and
displays it back to the team.

Pages: pipeline view, lenders/products, plus admin/ingest screens.

The dashboard is **internal only** — not public. The codebase, however,
is currently in a public GitHub repo, so the same rule applies as to any
public code: **no secrets, no client data**.

## 2. ⚠️ Sensitivities to know up front

- This connects to a **production Postgres** with real adviser deals.
- It uses **production Trail API credentials** — accidental writes could pollute
  the CRM.
- It scrapes external sites — be a polite client (no rapid loops, no missing
  user-agents).
- It uses **Anthropic's API** for parsing — costs money per call.
- Multiple secrets in `.env.local`: Trail API key, Vercel Postgres URL, Google
  OAuth client + token, Anthropic API key. **All gitignored. Keep them that way.**

If your task is just frontend (a new view, a copy change, a chart), you'll
probably never need to touch production data — work against mock data and don't
run any of the `npm run trail:*` / `npm run scrape:*` / `npm run db:*` scripts.

If your task does need production data, **ask Chris first** and he'll either
walk you through the safe way or do the data-touching parts himself.

## 3. Local setup

**Prerequisites:**
- Node.js 18+
- Git (Windows: install Git for Windows from [git-scm.com](https://git-scm.com/download/win), gives you Git Bash too)
- Claude Code with an active Anthropic subscription
- A GitHub account (you should have an invite at [github.com/ChrisTanta12/tanta-pipeline/invitations](https://github.com/ChrisTanta12/tanta-pipeline/invitations) — accept it)

**Steps:**
```bash
git clone https://github.com/ChrisTanta12/tanta-pipeline.git
cd tanta-pipeline
npm install
```

**Environment variables.** This project requires a `.env.local` with several
secrets. **Don't ask another collaborator to send you theirs by Slack, email,
or chat.** Ask Chris — he'll either:

- Send the values via a secure channel (1Password vault, encrypted file, etc.)
- Set you up with read-only or scoped credentials
- Decide your task doesn't need them and you can mock the relevant calls

Without secrets, you can still run `npm run dev` to see the UI shell — many
pages will fail to load data, but page structure, components, and styling are
all editable without DB access.

**Never commit `.env.local`** — `.gitignore` covers it but always sanity-check
with `git status` before committing.

## 4. Workflow

```bash
git checkout main && git pull
git checkout -b feature/T-XXX-short-slug

# ...do the work...

npm run build                # catch type errors
git add -A
git diff --cached            # *** eyeball this for leaked secrets ***
git commit -m "describe the change"
git push -u origin feature/T-XXX-short-slug
gh pr create --fill
```

When you push, Vercel automatically builds a preview URL and posts it on the
PR. Chris reviews, requests changes if needed, and merges. After merge,
production auto-deploys.

## 5. File map

```
app/
├── layout.tsx                 Root layout
├── page.tsx                   Dashboard home (pipeline view)
├── globals.css                Tailwind + global styles
├── lenders/                   Lender / bank product listings
├── api/                       API routes
│   ├── pipelines/             Pipeline data fetch
│   ├── opportunities/         Opportunity-level operations
│   ├── trail-sync/            Trail → Postgres sync
│   ├── bank-rates/            Bank rate read API
│   ├── bank-rates-ingest/     Bank rate ingestion
│   ├── ingest-bank-updates/   Manual ingestion endpoint
│   ├── scrape-interest/       interest.co.nz scrape
│   ├── exec-check/            Exec dashboard checks
│   ├── tat-pin/               Turnaround-time pinning
│   └── tat-override/          TAT override
└── lib/
    ├── db.ts                  Vercel Postgres helpers — use these, don't import @vercel/postgres directly
    ├── types.ts               Shared types
    ├── anthropic.ts           Claude API wrapper for parsing
    ├── gmail.ts               Gmail API wrapper (for the ingest flow)
    ├── ingest.ts              Ingest pipeline
    ├── parsers/               PDF / email / structured-data parsers
    └── scrapers/              Per-site scrapers (interest.co.nz etc.)

scripts/
├── migrate.ts                 Postgres migrations
├── seed.ts                    DB seed (test data)
├── seed-from-gemini.ts        Seed from Gemini-extracted data
├── trail-sync.ts              Trail → Postgres sync runner
├── oauth-setup.ts             Google OAuth setup
├── scrape-interest.ts         interest.co.nz scraper runner
├── debug-profiles.ts          Debug Trail profile data
└── test-pdf-ingest.ts         PDF ingest test

apps-script/                   Google Apps Script for scheduled cron jobs
db/
├── schema.sql                 Production schema — do not edit without approval
└── seed.json                  Seed data
SETUP_BANK_RATES.md            Operational runbook for bank rates
SETUP_TRAIL_SYNC.md            Operational runbook for Trail sync
docs/
├── HANDOFF.md                 This file
└── TASKS/                     Task briefs Chris drops in here
```

## 6. Stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript**
- **Vercel Postgres** for data storage
- **Tailwind 3**
- **`tsx`** for scripts (run via `npm run db:*` / `trail:*` / `scrape:*` scripts)
- External integrations: **Trail CRM API**, **Google OAuth + Gmail**, **Anthropic API**, **interest.co.nz scrape**, **Apps Script cron**
- **Vercel** hosting · **GitHub auto-deploy** from `main`

## 7. What you can and can't change

### ✅ Free to change
- Frontend pages, components, styling
- Copy
- Mock data in dev / new test fixtures
- Any single component in `app/lib/parsers/` or `app/lib/scrapers/` if you're scoped to it

### ⚠️ Discuss before changing
- New top-level routes, new API routes
- `app/lib/db.ts` patterns — DB access conventions
- `app/lib/anthropic.ts` — costs per call
- Any new dependency (`package.json`)
- The `displayStage()` mapping (whatever file it lives in) — production stage handling

### ❌ Don't touch without explicit approval
- `db/schema.sql` — production DB shape
- `scripts/migrate.ts` and the `db:migrate` command
- Any script that hits production (Trail, Postgres, Google APIs)
- `.env.local` (and never commit it)
- `vercel.json`

## 8. Wrap-up checklist before opening a PR

- [ ] `npm run build` passes
- [ ] `git diff --cached` shows no leaked secrets / API keys / client identifiers
- [ ] No new dependencies without discussion
- [ ] No production scripts run without Chris's approval
- [ ] PR description: what, why, what to test, link to Vercel preview
