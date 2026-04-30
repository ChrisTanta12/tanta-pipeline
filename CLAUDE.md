# Tanta Pipeline — Claude Code instructions

You are working on **Tanta Pipeline**, an internal dashboard built by Chris that
syncs data from **Trail CRM** and **interest.co.nz** into Vercel Postgres and
shows it back to the team. Used by Tanta advisers to track mortgage deals
through the pipeline.

## ⚠️ This repo is currently public

The GitHub repo is currently **public** (anyone in the world can read the source).
That means:

- **Never commit secrets.** API keys, OAuth tokens, database URLs, client names —
  all of it lives in `.env.local`, which is gitignored. **Verify** with `git status`
  before every commit.
- **Never commit real client data.** Test data must be obviously fake.
- **Never log sensitive payloads.** Strip identifiers in any debug output you ship.

If Chris flips the repo to private later, these rules still hold — `.env.local`
is the right place for secrets regardless.

## Read these before doing anything

1. **[docs/HANDOFF.md](docs/HANDOFF.md)** — setup, workflow, what to avoid
2. **The rest of this file** — operational rules below
3. **[docs/TASKS/](docs/TASKS/)** — your specific task brief (Chris will tell you which file)
4. **[SETUP_BANK_RATES.md](SETUP_BANK_RATES.md)** and **[SETUP_TRAIL_SYNC.md](SETUP_TRAIL_SYNC.md)** — operational runbooks already in this repo

## Hard rules for this codebase

- **NEVER push to `main`.** Always work on a feature branch and open a pull request.
- **NEVER run `vercel deploy`.** Production deploys when Chris merges your PR.
- **NEVER run scripts against production data without explicit approval.** That
  includes `npm run trail:sync`, `npm run db:migrate`, `npm run db:seed`,
  `npm run scrape:interest`, anything in `scripts/`. These touch the real
  Postgres DB or hit external APIs with real credentials.
- **NEVER commit `.env.local`** or any file containing API keys, tokens, or DB URLs.
- **NEVER log full Trail API payloads, OAuth tokens, or client identifiers** to
  console or to disk in committed code. Strip them or use placeholders.
- **DO NOT change the stage remapping in `displayStage()`** without explicit
  approval — Chris has a specific production mapping that has to stay stable.
- **DO NOT change `db/schema.sql`** without coordinating with Chris — the production
  Postgres has live data shaped to this schema.

## Conventions you must follow

- **TypeScript everywhere.** `tsx` is used for scripts.
- **Server-only secrets.** Anything from `process.env.*` that isn't prefixed
  with `NEXT_PUBLIC_` must be referenced only from server components, route
  handlers, or scripts — never from a `"use client"` file.
- **Database access via `app/lib/db.ts`.** Don't `import { sql } from
  '@vercel/postgres'` directly in components — use the helpers.
- **Trail API access via the existing `app/api/trail-sync/` patterns.** Don't
  add new direct Trail fetches scattered through the app.
- **Standard branch / PR workflow.** Same as the other Tanta repos.

## Your workflow

1. `git checkout main && git pull` — start fresh
2. `git checkout -b feature/T-XXX-short-slug` — your branch
3. Make changes, test locally with `npm run dev` (against your own local Postgres
   if you have one — never against the production DB unless Chris says so)
4. `npm run build` to catch type errors before committing
5. `git add -A && git diff --cached` — *eyeball the diff for any leaked secrets*
6. `git commit -m "describe the change"`
7. `git push -u origin feature/T-XXX-short-slug`
8. `gh pr create --fill` — opens a PR for review

The PR auto-creates a Vercel preview URL (against the staging DB if there is
one, otherwise no DB). Chris reviews and merges.

## When you finish a session

- All changes committed and pushed to your feature branch
- Note in your final message: branch name, PR URL, what's done, what's left,
  any environment variables you needed but couldn't get to (so Chris can wire
  them up to the Vercel project)
