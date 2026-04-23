# Trail sync / Pipeline dashboard

## Status
Stable sync, UI polish ongoing.

## Next action
Document the Windows Task Scheduler `npm.cmd` path gotcha in `SETUP_TRAIL_SYNC.md`. 15 min — run `where npm` on the office PC and paste the output into the setup doc.

## Notes
- Code: `scripts/trail-sync.ts`, `app/page.tsx`, `db/schema.sql` (trail_* tables)
- Setup: `SETUP_TRAIL_SYNC.md`
- Runs daily 4pm via Windows Task Scheduler on office PC (Trail IP whitelist)
- Manual sync: dashboard "last synced" → modal → paste `npm run trail:sync` on office PC
- Stage mappings are hardcoded for "Mortgage Advice" pipeline
