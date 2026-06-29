# Handoff 08 — Automation builder (Section 8 entry)   (Section 7 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (spec; §4 load-bearing decisions, §5 scope, §6 partitions)
- this file
- files Section 8 edits/reads:
  - `prisma/schema.prisma` — `AutomationRule` (trigger/conditions/actions Json) + `AutomationRunLog`
    (append-only) already exist; grep field names before any migration
  - `src/app/board/task/actions.ts` `setStatusAction` AND `src/app/board/actions.ts`
    `changeStatusAction` — the two status paths to hook automation triggers into (the §6
    Done-gate and §7 recurrence are already mirrored across both; do the same)
  - `src/lib/recurrenceWorker.ts` — the reusable single-pass worker pattern §8 shares for
    time-based triggers; `src/app/api/recurrence/run/route.ts` — the cron-style route pattern
  - `src/lib/recurrence.ts` (transactional spawn) + `src/lib/recurrenceTrigger.ts` (shared
    inline hook) — the structural template for an inline rules engine
  - `src/domain/activity.ts` + `src/lib/activity.ts` — append-only activity (add automation
    activity types here, with a test, as §6/§7 did)
  - `src/domain/scope.ts` / `src/lib/scope.ts` — row-level scoping; reuse `findVisibleTask`
- reference: `PRODUCT.md`, `DESIGN.md`, the `impeccable` skill for the builder UI

## 2. What Section 7 built (Recurring tasks)
The recurrence config UI in the detail panel, an inline ON_STATUS_CHANGE engine hooked into
BOTH status paths, and a reusable ON_SCHEDULE scheduled worker. Load-bearing decision (00 §4):
**status-on-recur is configurable, default `TODO`** — the spawned copy resets to To Do
(legacy ClickUp). Old instance leaves the board (archived; never hard-deleted).

- **Pure next-occurrence date math (TDD, load-bearing).** `src/domain/recurrence.ts`
  (+ `recurrence.test.ts`, 27 tests): `advanceDate(anchor, spec, tz)` = ONE cadence step,
  `nextOccurrence(anchor, from, spec, tz)` = first occurrence strictly after `from`. UTC-stored,
  computed in the actor's zone (composes the `dates.ts` zone↔midnight conversion). Month/year
  clamp out-of-range days (Jan 31 → Feb 28/29; Aug 31 → Sep 30; Feb 29 → Feb 28); daily/weekly/
  custom are exact day arithmetic; DST boundaries shift the stored UTC instant by the offset
  delta automatically. `shouldRecurOnStatus(rule, old, new)` is the pure ON_STATUS_CHANGE gate
  (fires only on a real transition INTO the configured `triggerStatus`; never on a no-op).
- **Transactional spawn engine.** `src/lib/recurrence.ts` `spawnRecurrence({taskId,timeZone,
  actorId})`: in ONE `$transaction` it creates a fresh copy reset to `statusOnRecur` carrying
  title/board/parentId/description/priority/timeEstimate/assignees/tags/customFieldValues(+people)
  and the recurrence rule; advances start/due by one cadence step when `syncToDueDate`; sets the
  new rule's `nextRunAt` (ON_SCHEDULE only); ARCHIVES the old task and DELETES its rule (the
  copy now owns recurrence). **Idempotency hinge:** the rule is consumed in the txn, so a
  re-trigger finds none and no-ops. Emits `recurrence_spawned` (old) + `recurrence_closed` (new).
- **Inline ON_STATUS_CHANGE hook, mirrored across BOTH status paths.** `src/lib/recurrenceTrigger.ts`
  `maybeRecurOnStatusChange` (re-reads the rule from the DB, runs the pure gate, delegates to
  `spawnRecurrence`; best-effort — never fails the status change). Called from
  `setStatusAction` (`src/app/board/task/actions.ts:134`, inside the `task.status !== status`
  block) and `changeStatusAction` (`src/app/board/actions.ts:122`, same guard) — exactly as the
  Done-gate was mirrored. Both call sites already re-authorize via `findVisibleTask`.
- **Scheduled worker (ON_SCHEDULE), reusable + system-actor.** `src/lib/recurrenceWorker.ts`
  `runScheduledRecurrences(now = new Date())`: single pass over rules with `nextRunAt <= now`
  (UTC clock), spawning each via `spawnRecurrence` with `actorId: null`. Runs WITHOUT a session,
  applies NO per-user scope (system actor). Returns `{scanned,spawned,spawnedTaskIds,errors}`,
  importable + unit-testable. Invoked by `npm run recur:worker` (`scripts/run-recurrence-worker.ts`)
  AND `POST/GET /api/recurrence/run` (`src/app/api/recurrence/run/route.ts`), gated by a
  `Bearer ${CRON_SECRET}` header OR a CEO session (a MEMBER can never trigger it). **§8 shares
  this worker + route pattern for time-based automation triggers.**
- **UI.** `RecurrenceSection` in `TaskPanelExtras.tsx` (rendered in `TaskPanel.tsx`) matches the
  ClickUp picker: cadence dropdown, "Every N", trigger (on status change / on schedule),
  "When status becomes <triggerStatus>", "Create a new task (the completed one leaves the
  board)", "Update status to <statusOnRecur>", "Sync recurrence to due date", Save/Cancel/Remove,
  plus a collapsed summary. Styles in `panel.module.css` (`.rec*`), all via CSS tokens.

## 3. Files added/changed
- `src/domain/recurrence.ts` + `recurrence.test.ts` — pure date math + status gate (NEW, TDD, 27 tests).
- `src/domain/activity.ts` + `activity.test.ts` — added `recurrence_spawned`/`recurrence_closed` (CHANGED, +1 test).
- `src/lib/recurrence.ts` — transactional spawn engine (NEW).
- `src/lib/recurrenceTrigger.ts` — shared inline ON_STATUS_CHANGE hook (NEW).
- `src/lib/recurrenceWorker.ts` — reusable ON_SCHEDULE single-pass worker (NEW).
- `scripts/run-recurrence-worker.ts` — CLI entry; `npm run recur:worker` (NEW).
- `src/app/api/recurrence/run/route.ts` — HTTP worker trigger, CRON_SECRET / CEO-gated (NEW).
- `src/app/board/task/actions.ts` — `setRecurrenceAction`/`clearRecurrenceAction` + recur hook in `setStatusAction` (CHANGED).
- `src/app/board/actions.ts` — recur hook in `changeStatusAction` (CHANGED).
- `src/app/board/task/data.ts` — loads `recurrence` into `TaskDetail` (CHANGED).
- `src/app/board/task/TaskPanelExtras.tsx` — `RecurrenceSection` UI + icons (CHANGED).
- `src/app/board/task/TaskPanel.tsx` — render `RecurrenceSection` (CHANGED).
- `src/app/board/task/panel.module.css` — `.rec*` styles (CHANGED).
- `prisma/schema.prisma` + migration `20260629094128_recurrence_trigger_status_and_sync` —
  added `RecurrenceRule.triggerStatus` (default REVIEWED) and `.syncToDueDate` (default true) (CHANGED).
- `package.json` — `recur:worker` script + explicit `dotenv` devDependency (CHANGED).
- `docs/handoffs/08-automation.md` — this file (NEW).

## 4. State of the world
- **Migrations:** 2 applied. New: `20260629094128_recurrence_trigger_status_and_sync` (additive
  columns only). `npx prisma validate` ok · `migrate status`: "Database schema is up to date!".
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`. Optional
  `CRON_SECRET` to let an external scheduler hit `/api/recurrence/run` (without it, only a CEO
  session may run the worker route). Optional `SUPABASE_*` for attachments (still degrades).
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in (`noel@halevora.com`/`halevora` CEO; `member1@halevora.com`/`halevora` MEMBER). Run the
  scheduled worker once with `npm run recur:worker`.
- **Verified (this session):**
  - `npm run typecheck` clean · `npm test` **163/163** (was 135; +28) · `npm run build` clean ·
    `prisma validate` + `migrate status` in sync · dev booted, no runtime errors.
  - **Worker integration (script):** an ON_SCHEDULE rule with a past `nextRunAt` → exactly 1
    spawn (status TODO, dates advanced one week in the creator's zone, new `nextRunAt` strictly
    future, assignee carried), old archived + rule consumed; a SECOND pass spawned 0 (idempotent).
  - **Browser (chrome-devtools), CEO=Noel:** configured the recurrence picker on "Launch summer
    retargeting campaign" (Weekly, on status change→Reviewed, update status to To Do, sync on);
    marked it Reviewed → the old instance LEFT the board and a fresh copy appeared **reset to
    TODO** with **due advanced Jul 1→Jul 7** (Asia/Jerusalem); the new instance's detail shows
    status To Do, the carried recurrence rule, and a `recurrence_closed` activity. Desktop +
    390px mobile screenshots clean; **no console errors**.
  - **Browser, MEMBER=member1:** a member-owned recurring task ("Refresh creative", daily, on
    status→Done) marked Done → old left the board, a **fresh TODO instance appeared visibly to
    member1** (due Jul4→Jul5, member assigned). CEO's spawned instance was NOT visible to
    member1 (scope intact). No console errors.
  - **Audits:** **RECURRENCE OK** (all 9 checklist items pass) and permissions **AUDIT PASS**
    (0 leaks; every user-triggered mutation re-authorizes via `findVisibleTask`; the worker's
    unscoped reads are the deliberate trusted-system path, gated CRON_SECRET/CEO).
- **Smoke data reset:** all test recurrence rules deleted, spawned duplicates removed, the two
  seed tasks restored to seed status/dates/assignees, `recurrence_*` activity rows cleared. Dev
  DB recurrence-rule count = 0; 8 live top-level tasks (seed baseline).

## 5. Open issues / deferred
- **CUSTOM cadence** is implemented as "every N days" (the `interval` escape hatch). The schema's
  `byWeekday`/`byMonthday`/`config` are present but not yet surfaced in the UI (e.g. "every Mon &
  Thu", "the 1st of each month"). The pure step is structured to extend there; add UI + math when
  product needs richer custom rules. (`src/domain/recurrence.ts` `stepCalendarDay`.)
- **`nextOccurrence` loop cap** is 12,000 steps with a from-anchored fallback — safe for all
  realistic anchors; if an extreme anchor (decades of daily) ever matters, replace the loop with a
  closed-form phase computation.
- **No realtime push** of a spawned instance — it appears on the next board load/`router.refresh`.
  §11 realtime can emit a board event on spawn (scope the event per the permissions audit).
- The worker route accepts GET (some schedulers only issue GET); both verbs share the same auth.

## 6. NEXT SECTION (Section 8): Automation builder  — depends on §1, §3, §7
**Goal:** a build-your-own **trigger / condition / action rules engine** that runs on task events
(status change, assignee change, due-date change, etc.) PLUS time-based triggers, AND a **builder
UI** to create/edit rules. This is the LARGEST section — **plan a PARTIAL split: 8a engine / 8b
builder-UI**, writing a `status: PARTIAL` handoff at the 8a→8b boundary.

**The model (already in the schema — confirm fields before any migration):** `AutomationRule`
{ `boardId`, `name`, `enabled`, `trigger` Json `{type,config}`, `conditions` Json (array),
`actions` Json (ordered array), `order`, `createdById` } and the append-only `AutomationRunLog`
{ `ruleId`, `taskId?`, `status` ("success"|"skipped"|"error"), `detail` Json }.

**First 3 steps (8a — engine):**
1. **Pure engine in `src/domain/` (TDD).** Define the trigger/condition/action vocabulary as
   discriminated unions; write pure `evaluateConditions(conditions, taskContext)` and
   `planActions(actions, taskContext)` (pure → a list of intended mutations) with hard tests
   (AND/OR clauses, equality/contains/before-after operators, missing fields, no-op actions).
   Keep ALL branching logic here, framework-free, exactly like `src/domain/recurrence.ts`.
2. **Event-driven execution glue (server).** A `src/lib/automation.ts` `runAutomationsForEvent(
   {boardId, taskId, event, actorId})` that loads enabled rules for the board, evaluates the pure
   engine, applies the planned mutations (re-using scoped helpers; re-authorize), and writes an
   `AutomationRunLog` row per rule (append-only). Hook it into BOTH status paths
   (`setStatusAction` + `changeStatusAction`) like §6/§7, plus the assignee/date mutations in
   `actions.ts`. Idempotency + loop-guard (an action that changes status must not infinitely
   re-trigger — cap re-entrancy depth).
3. **Time-based triggers via §7's worker infra.** Add a scheduled pass (reuse the
   `runScheduledRecurrences` pattern + the `/api/recurrence/run` route style, or generalize both
   into one worker entry) that fires time-based automation triggers. Then **8b**: the builder UI
   (rule list per board, a trigger picker → condition rows → action rows, enable/disable,
   reorder) matching `DESIGN.md` + the `impeccable` skill.

**Gotchas:**
- **Scope + re-auth** every rule-driven mutation (`findVisibleTask` / scoped writes). The scheduled
  automation pass runs WITHOUT a session — system actor, no per-user scope, like §7's worker.
- Put the rules logic in `src/domain` and TDD it; the engine glue just applies the plan.
- `AutomationRunLog` is append-only — write one row per evaluation (success/skipped/error).
- Guard against trigger loops (an action's mutation re-firing the same/another rule); cap depth.
- Run `halevora-permissions-audit` (+ a recurrence re-check if you touch the shared worker) and
  `halevora-qa-gate` before the Section 9 handoff. Browser-smoke a full rule (event → condition →
  action) with a CEO and a MEMBER.
