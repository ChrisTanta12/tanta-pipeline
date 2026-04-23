# Lenders / Bank Rates dashboard

## Status
In use daily. Core pipeline stable. Iterative polish ongoing.

## Next action
Investigate the 3 PDF-ingest reverts in recent git history — root-cause them so they don't come back. 45 min: `git log --grep=revert --oneline` then read each.

## Notes
- Code: `app/lenders/`, `app/api/ingest-bank-updates/`, `scripts/scrape-interest.ts`, `scripts/test-pdf-ingest.ts`
- Setup: `SETUP_BANK_RATES.md`
- Known gaps: Kiwibank 18mo rate null (awaiting data), Vision `needs_review` entries require manual audit
- Dependencies: Vercel Postgres, Gmail OAuth, Anthropic API, CRON_SECRET
