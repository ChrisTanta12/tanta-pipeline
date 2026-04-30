# Task brief — [SHORT TITLE]

> **For the assignee:** Read this first, then `docs/HANDOFF.md`, then `CLAUDE.md`. Branch named `feature/T-XXX-short-slug`.

---

## What

One sentence: what are we building?

## Why

One paragraph: which adviser problem does this solve, who benefits?

## Where it lives

- [ ] New page at `/____`
- [ ] Component change on existing page (which?)
- [ ] New API route at `/api/____`
- [ ] Backend script in `scripts/____`

## Production data exposure

- [ ] Frontend only — works against mock / dev data, no production credentials needed
- [ ] Reads production data — needs Trail / Postgres credentials (Chris coordinates)
- [ ] Writes production data — Chris's explicit approval required, may handle the run himself

## Specifics

Bullet list of concrete requirements. Be opinionated about:
- Data shape — what fields, what types, what constraints
- UI — layout, components, states (loading / empty / error)
- Edge cases — what if the API is slow, returns empty, fails with 401, etc.

## Don't do these

- Don't commit `.env.local` or any secret
- Don't run production scripts (`trail:sync`, `db:migrate`, etc.) without explicit approval
- Don't change `db/schema.sql`
- Don't change `displayStage()` mapping
- Don't add new dependencies without asking
- Don't deploy or merge — just open a PR

## What "done" looks like

- [ ] `npm run build` passes
- [ ] No secrets in the diff (`git diff --cached` reviewed)
- [ ] PR opened with description + Vercel preview URL
- [ ] If any new env var is needed but you couldn't get it, list it in the PR description so Chris can wire it up to Vercel

---

## Reviewer notes (filled in by Chris)

- (left blank until review)
