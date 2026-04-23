# Portal TAT workflow

## Status
Just tuned (Mon+Wed schedule, support@tanta.co.nz default). Observation mode.

## Next action
**Do nothing.** Watch for 2 weeks. Touch only if production-breaking.

## Notes
- Code: `apps-script/TatCheck.gs`, `app/api/bank-rates-ingest/`
- Why ANZ + Kiwibank need this: portals are auth-gated, can't be crawled
- Staff workflow: email Mon+Wed 9am NZT → reply with numbers → parsed every 2hrs → POSTed to ingest endpoint
