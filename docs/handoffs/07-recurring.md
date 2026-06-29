# Handoff 07 — Recurring tasks (Section 7 entry)   (Section 6 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (spec; §4 load-bearing decisions, §5 scope)
- this file
- files Section 7 edits/reads:
  - `prisma/schema.prisma` — `RecurrenceRule` (one-to-one with `Task` via `Task.recurrence`)
  - `src/domain/dates.ts` — timezone-aware date helpers (next-occurrence math composes here)
  - `src/app/board/task/actions.ts` — `setStatusAction` is where the ON_STATUS_CHANGE recur
    engine hooks in (a task hitting the trigger status spawns a fresh copy)
  - `src/app/board/actions.ts` — `changeStatusAction` (board path) is the OTHER status path;
    the recur trigger must fire here too (mirror, like the Done-gate did)
  - `src/app/board/task/data.ts` / `TaskPanel.tsx` / `TaskPanelExtras.tsx` — detail UI to add
    the recurrence config picker
  - `src/lib/activity.ts` + `src/domain/activity.ts` — emit/format a `recurrence_*` activity
  - `.claude/skills/halevora-recurrence-audit` — run before the Section 8 handoff
- reference: the screenshot `C:\Users\david\Downloads\Noel\WhatsApp Image 2026-06-29 at 00.43.09.jpeg`
  (the exact recurrence picker), `PRODUCT.md`, `DESIGN.md`

## 2. What Section 6 built (Task dependencies)
Blocking / waiting-on links between tasks, with **cycle prevention**, a server-enforced
**Done-gate**, and a scoped link picker. `TaskDependency` (a single directed edge
`blocker → blocked`) was already in the schema; **no migration** was needed.

- **Pure cycle prevention (load-bearing, TDD).** `src/domain/dependencies.ts` (+ 17 tests):
  `wouldCreateCycle(edges, candidate)` DFS over the directed graph (the new edge `b→c` is a
  cycle iff `b` is reachable from `c`); `validateNewDependency(edges, candidate)` rejects, in
  order, self-edge / duplicate / cycle; `openBlockerCount(blockers)` counts non-closed
  blockers. Tested hard: direct cycle, transitive + 4-hop cycle, diamond (no cycle), parallel
  forward edge (no cycle), disconnected components, self-edge, duplicate, reverse-of-existing.
- **Mutations, both endpoints re-authorized.** In `src/app/board/task/actions.ts`:
  `addDependencyAction` (a `direction` of `"blocking"` or `"waiting_on"` decides which endpoint
  the current task is; re-auths BOTH ids via `findVisibleTask`; rebuilds the trusted edge set
  from the DB and runs `validateNewDependency` BEFORE insert), `removeDependencyAction`
  (re-auths both ids, deletes by the exact `@@unique([blockerId, blockedId])` pair — never a
  raw client dependency id), and `searchLinkableTasksAction` (SCOPED picker search composing
  `taskScopeWhere(actor)`; excludes self + already-linked). Each emits append-only
  `dependency_added` / `dependency_removed` activity via `src/lib/activity.ts`.
- **Done-gate, server-enforced in BOTH status paths.** Refuses `DONE` and `REVIEWED`
  ("more done than Done") while the task has any OPEN blocker (a `TaskDependency` whose
  `blocker` is not `isClosed`). Returns `{ error: "Blocked by N open task(s)." }`.
  - Detail panel: `src/app/board/task/actions.ts` `setStatusAction` — the gate is
    `countOpenBlockers(task.id)` checked before the update (actions.ts:115-121 area).
  - Board dropdown: `src/app/board/actions.ts` `changeStatusAction` — the same check inline
    using the shared pure `openBlockerCount` (actions.ts:101-115 area).
  - The board `StatusBadge` and the panel `StatusControl` both surface the returned `{error}`
    (a transient toast / inline message) — but the enforcement is the SERVER, not the UI.
- **UI.** Detail panel `DependenciesSection` (in `TaskPanelExtras.tsx`): a "Waiting on" list
  and a "Blocking" list, each with a debounced scoped search-picker to add a link and a remove
  button per row; a gate hint banner when blocked. The board card (`Board.tsx`) shows a small
  red **"Blocked"** pill when `openBlockerCount > 0`. The scoped detail loader (`data.ts`)
  loads `waitingOn` / `blocking` (titles SCOPED to visible tasks) plus an honest
  `openBlockerCount` (over ALL edges, so a member cannot bypass the gate by being unable to see
  a blocker).

## 3. Files added/changed
- `src/domain/dependencies.ts` + `dependencies.test.ts` — pure cycle/gate logic (NEW, TDD, 17 tests).
- `src/domain/activity.ts` + `activity.test.ts` — added `dependency_added`/`dependency_removed` (CHANGED, +1 test).
- `src/app/board/task/actions.ts` — dependency mutations + scoped picker search + Done-gate in `setStatusAction` (CHANGED).
- `src/app/board/actions.ts` — Done-gate in the board `changeStatusAction` (CHANGED).
- `src/app/board/task/data.ts` — loads `waitingOn`/`blocking`/`openBlockerCount` (scoped) (CHANGED).
- `src/app/board/data.ts` — `BoardCard.openBlockerCount` for the card indicator (CHANGED).
- `src/app/board/task/TaskPanelExtras.tsx` — `DependenciesSection` + scoped picker UI (CHANGED).
- `src/app/board/task/TaskPanel.tsx` — render the section; `StatusControl` now surfaces the gate `{error}` (CHANGED).
- `src/app/board/Board.tsx` — "Blocked" card indicator + `StatusBadge` surfaces the gate `{error}` (CHANGED).
- `src/app/board/board.module.css` / `task/panel.module.css` — dependency + blocked-indicator styles (CHANGED).
- `docs/handoffs/07-recurring.md` — this file (NEW).

## 4. State of the world
- **Migrations:** unchanged — `20260629020818_init_data_model` only. `TaskDependency` already
  existed in the schema; **no new migration**. `npx prisma validate` ok · `migrate status`:
  "Database schema is up to date!".
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY` (in `.env`).
  Optional `SUPABASE_*` for attachments (still unset; degrades gracefully).
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in at `/login` (`noel@halevora.com` / `halevora`, CEO; `member1@halevora.com` /
  `halevora`, MEMBER).
- **Verified (this session — exactly what was run/clicked):**
  - `npm run typecheck` clean · `npm test` **135/135** (was 117; +18) · `npm run build` clean ·
    `npx prisma validate` + `migrate status` in sync · dev server booted with no runtime errors
    (started, smoke-tested, stopped).
  - **Browser smoke (chrome-devtools, CEO = Noel):** added a "waiting on" link
    (Research ← Draft) and a "blocking" link (Research → Refresh) via the scoped pickers;
    tried to mark the blocked task DONE via the detail status control → **server refused**,
    task stayed TODO (verified in DB, not just the UI); closed the blocker (Draft → DONE) then
    the blocked task **was allowed** to go DONE; the board card showed the red **"Blocked"**
    indicator on "Refresh creative"; **removed** a link (edge count + activity log confirmed);
    attempted a **cycle** (Refresh → Draft over chain Draft→Research→Refresh) → **server
    refused** with "That would create a circular dependency", no edge inserted. Activity log
    captured all 3 dependency events with correct direction + title.
  - **Member smoke (member1):** the link picker returned **only** member1's 2 visible assigned
    tasks ("Prototype…", "Ship the dark theme tokens") — no CEO-only tasks leaked; a blocker
    member1 cannot see had its **title hidden** in the "Waiting on" list while the gate count
    stayed honest ("blocked by 1 open task"). Desktop + 390px mobile screenshots clean; **no
    console errors/warnings** in either account.
  - **Permissions audit (`halevora-permissions-audit` methodology):** **AUDIT PASS.** Every new
    read/write path (`addDependencyAction`, `removeDependencyAction`, `searchLinkableTasksAction`,
    detail-loader dependency lists, both Done-gate status paths) re-authorizes via
    `findVisibleTask` and/or composes `taskScopeWhere`. The only unscoped reads are the
    blocker-status counts, which are intentionally unscoped (prevents a member from bypassing the
    gate) and select no leakable content (`status` only).
- **Smoke data reset:** statuses restored to seed and the test `TaskDependency` edges deleted
  (dev DB `TaskDependency` count = 0). Other §5 demo artifacts remain (harmless; seed idempotent).

## 5. Open issues / deferred
- The detail `StatusControl` gate error is a transient inline message (auto-clears after ~5s);
  the board `StatusBadge` error is a transient toast. Both are surfacing of a real server
  refusal — fine for v1; a sturdier toast system can come in §13 Polish.
- Dependency lists in the detail panel show only tasks the actor can SEE (correct, no leak),
  so a member may see "blocked by N" without seeing which task. That is the intended
  honest-gate-vs-scoped-display tradeoff; if product wants an anonymized "1 hidden task" row,
  add it in §13.
- No cross-board restriction on links (a task on board A can block one on board B) — matches
  ClickUp and the brief; intended.

## 6. NEXT SECTION (Section 7): Recurring tasks
**Goal:** the recurrence config UI in the detail panel **+** an inline on-status-change engine
**+** a scheduled worker for ON_SCHEDULE. Load-bearing decision (00 §4): **status-on-recur is
configurable, default `TODO`** — the new instance resets to To Do (legacy ClickUp behavior).

**The model (already in the schema — confirm fields before adding a migration):** `RecurrenceRule`
is one-to-one with `Task` (`Task.recurrence`). Cadence enum `DAILY | WEEKLY | MONTHLY | YEARLY |
CUSTOM`; trigger `ON_STATUS_CHANGE | ON_SCHEDULE`; `statusOnRecur` (default `TODO`); a
`nextRunAt` the scheduled worker reads. (Grep the schema for the exact field names — `interval`,
`triggerStatus`, `syncToDueDate`, etc. — and only migrate if a needed field is missing.)

**First 3 steps:**
1. **Pure next-occurrence date math** in `src/domain/` (e.g. `recurrence.ts`) with TDD: given a
   rule (cadence + interval + an anchor date) and a "from" instant in the actor's timezone,
   return the next occurrence. Test hard: daily/weekly/monthly/yearly, interval > 1,
   month-end rollover (Jan 31 → Feb 28/29), DST boundaries, "sync to due date" offset. Compose
   the existing `src/domain/dates.ts` timezone helpers (store UTC, compute in the actor's zone).
2. **Inline ON_STATUS_CHANGE engine.** When a task hits its trigger status (the recurrence's
   `triggerStatus`, e.g. Reviewed), spawn a **fresh copy** reset to `statusOnRecur` (carry
   title/board/assignees/description/etc. per the screenshot's "Create new task"), advance the
   due/start dates by the cadence if "sync to due date" is on, and the **old instance leaves the
   board** (it is already closed; it simply no longer recurs). Hook this into BOTH status paths
   that Section 6 touched — `setStatusAction` (detail) AND `changeStatusAction` (board) — exactly
   as the Done-gate was mirrored. Keep it idempotent (don't double-spawn on re-trigger).
3. **Recurrence config UI** in the detail panel matching the screenshot picker: a cadence
   dropdown, "On status change: Reviewed", "Create new task", "Update status to: TO DO"
   (= `statusOnRecur`), and "Sync recurrence to due date". Then the **scheduled worker** for
   ON_SCHEDULE: a server entry point (route handler or script) that reads due `RecurrenceRule`s
   by `nextRunAt`, spawns the next instance, and advances `nextRunAt` via the pure step from
   step 1. (§8 automation shares this scheduled-worker infra — keep it reusable.)

**Gotchas:**
- **Scope + re-auth** every mutation (reuse `findVisibleTask`); the spawned copy must be
  visible to whoever should see it (assign like the §3/§4 create paths do, so a member sees
  their own new instance). The scheduled worker runs without a session — give it a clear
  system actor / service context and do NOT apply per-user scope to its writes.
- Put the date math in `src/domain` and TDD it; the engine just calls the pure step.
- `ActivityLog` is append-only — emit a `recurrence_*` activity on spawn (add the type to
  `src/domain/activity.ts` + a test, like §6 did for dependencies).
- Run `halevora-recurrence-audit` + `halevora-qa-gate` before the Section 8 handoff.
  Browser-smoke a full recur cycle (trigger status → new instance appears reset to TODO, old
  leaves the board) with a CEO and a MEMBER.
