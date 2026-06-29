---
name: halevora-qa-gate
description: Run before every section handoff and before any deploy of Halevora Tasks. Verifies typecheck, tests, build, Prisma schema/migration validity, seed, local boot, a focused browser smoke test, that no secrets are committed, and that the section handoff is written. Use whenever finishing a build section, preparing a handoff, or about to deploy. Do not mark a section complete if this gate fails.
user-invocable: true
argument-hint: "[section-name]"
---

# Halevora QA Gate

Definition-of-done gate for Halevora Tasks. **A section is not complete until every check
below passes.** If any check fails, stop, fix it, and re-run the gate. Do not write a
"COMPLETE" handoff over a failing gate — mark it `PARTIAL` with the exact failure instead.

## Checklist (run in order, report each result)

1. **Types** — `npm run typecheck`. Zero errors across the workspace.
2. **Unit tests** — `npm test`. All green. If this section added domain logic, it added
   tests for it; a section that grew `src/domain` with no new tests fails this gate.
3. **Build** — `npm run build`. Completes clean (tsc + next build).
4. **Prisma is valid** — `npx prisma validate`. Schema parses. Then confirm migrations are
   in sync: `npx prisma migrate status` reports no pending/drifted migrations. Never leave
   the schema edited without a matching migration.
5. **Seed works** (when the section touches the data model or seed) —
   `npm run db:seed` against a clean/dev DB succeeds and is idempotent enough to re-run.
6. **App boots** — `npm run dev` starts without runtime errors in the server log.
7. **Browser smoke test** — drive the actual feature this section built. Use the
   `chrome-devtools` MCP (or the project preview tools): load the relevant route, exercise
   the primary flow, and confirm no console errors and no failed network requests. Capture
   one screenshot as proof. Mobile layout: resize to a phone viewport and confirm the
   primary flow is still usable.
8. **No secrets committed** — `git status` shows no `.env` (only `.env.example`), no
   `proxies.txt`, no keys. Grep the staged diff for obvious tokens
   (`SUPABASE`, `DATABASE_URL=postgres`, `SECRET`, private keys) and confirm none are real.
9. **Permissions implication reviewed** — if this section touched anything that reads or
   writes Task data, note whether row-level scoping is affected. If in doubt, run
   `halevora-permissions-audit`.
10. **Handoff written** — `docs/handoffs/NN-<slug>.md` exists for this section using the
    §8 template from `00-START-HERE.md`: changed files, state of the world (what was
    verified), open issues, and the next section's first three steps.

## Output

Report a short table: each check, PASS/FAIL, and the command output on any failure. End with
an explicit verdict: **GATE PASS** (safe to hand off / deploy) or **GATE FAIL** (with the
blocking items). Never imply done without the verdict line.
