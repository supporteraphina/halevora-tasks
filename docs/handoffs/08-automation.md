# Handoff 08 — Automation (engine + execution + builder UI)   (status: COMPLETE)

> Section 8 was split per the §6 plan: **8a = engine / execution / hooks / run log /
> time-based pass** (DONE + verified) and **8b = builder UI** (DONE + verified, §7 below).
> 8b built the builder UI **on top of** the 8a engine — it assembles + server-validates rule
> JSON via the engine's `parseRule` and never re-implements engine branching. The pure engine
> vocabulary the builder renders is in §6; the 8b additions are in §7.

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (spec; §4 load-bearing decisions, §5 scope)
- this file
- files 8b edits/reads:
  - `src/domain/automation.ts` — the pure engine + the EXACT trigger/condition/action
    vocabulary the builder must render (discriminated unions, validated by `parseRule`)
  - `prisma/schema.prisma` — `AutomationRule` { boardId, name, enabled, trigger Json,
    conditions Json, actions Json, order, nextRunAt, createdById } + append-only
    `AutomationRunLog`
  - `src/app/board/task/TaskPanelExtras.tsx` + `panel.module.css` — the §7 `RecurrenceSection`
    is the structural template for a per-board rule editor (picker → rows → save/cancel)
  - `src/lib/automation.ts` (engine glue) — 8b's create/update/delete actions write rules
    that this validates at runtime via `parseRule`
  - reference: `PRODUCT.md`, `DESIGN.md`, the `impeccable` skill

## 2. What 8a built (Automation engine + execution)

A build-your-own **trigger / condition / action** rules engine that runs on task events AND
on a time-based schedule, with an append-only run log. NO builder UI yet (that is 8b).

- **Pure engine (TDD), `src/domain/automation.ts` (+ `automation.test.ts`, 39 tests).**
  All branching logic, framework-free, mirroring `src/domain/recurrence.ts`. NEVER throws —
  a malformed rule yields a safe default (skipped), exactly like the "providers never throw"
  idiom. Exports:
  - `parseRule(raw)` — normalizes/validates stored Json → an `AutomationRule` or `null`
    (unknown trigger type ⇒ null; malformed conditions/actions are dropped, not fatal).
  - `triggerMatchesEvent(trigger, event)` — does this rule fire for this event? (optional
    `config.to` pins status/priority destination; `config.tag` pins a tag name).
  - `evaluateConditions(input, taskContext)` → bool. Flat array = implicit AND; an explicit
    `{ match:"all"|"any", conditions }` group = AND/OR. Empty/all-malformed ⇒ vacuously true.
  - `planActions(actions, taskContext)` → ordered `PlannedMutation[]`. Re-validates each
    action, **elides no-ops** (set_status to current status, add a tag already present, etc.)
    so the glue never does a redundant write that could needlessly re-trigger.
- **Execution glue (server), `src/lib/automation.ts`.** `runAutomationsForEvent({ boardId,
  taskId, event, actorId, depth })` loads enabled board rules ordered (`order`, then
  `createdAt`), runs the pure engine over a FRESH task context (re-read per rule), applies
  the plan as **SYSTEM writes**, writes **one append-only `AutomationRunLog` row per rule**
  (`success` | `skipped` | `error`, with a `detail` Json reason), and emits one
  `automation_ran` activity per applied rule.
  - **Loop-guard / re-entrancy cap (MANDATORY, proven).** `MAX_AUTOMATION_DEPTH = 5`. A
    state-changing mutation (set_status / set_priority / assign / add_tag) emits a CASCADE
    event re-entering `runAutomationsForEvent` at `depth + 1`; the function returns
    immediately once `depth >= MAX_AUTOMATION_DEPTH` (`src/lib/automation.ts:265`,
    `if (depth >= MAX_AUTOMATION_DEPTH) return result;`). Proven by
    `src/lib/automation.guard.test.ts` (a ping-pong pair of mutually-triggering rules
    terminates at the cap; a second test asserts an at-cap call does nothing).
  - **Best-effort.** A rule that throws is logged `error` and the pass continues; the
    function never throws to its caller, so a user's underlying mutation never fails.
- **Inline hooks, `src/lib/automationTrigger.ts`** (mirrors `recurrenceTrigger.ts`): tiny
  `onStatusChanged` / `onPriorityChanged` / `onAssigneeChanged` / `onDueChanged` /
  `onTagAdded` wrappers that construct the event and call the glue, best-effort.
  Hooked into:
  - `src/app/board/actions.ts` `changeStatusAction` (board status path) — after the status
    write, alongside the §7 recurrence hook.
  - `src/app/board/task/actions.ts`: `setStatusAction`, `setPriorityAction`,
    `toggleAssigneeAction`, `setDateAction` (only when `field === "due"`), `toggleTagAction`
    (op=add) and `createTagAction`. Every call site is preceded by `findVisibleTask`
    (re-authorized) — the same gate §6/§7 used.
- **Time-based triggers, `src/lib/automationWorker.ts`** (a PARALLEL worker to §7's
  `recurrenceWorker.ts`, not a modification of it). `runScheduledAutomations(now)`: single
  pass over enabled rules with `nextRunAt <= now`; for each, fires a `scheduled` event
  against every non-archived top-level task on the rule's board (the rule's own conditions
  narrow which tasks change), then advances `nextRunAt` by `trigger.config.cadence` /
  `interval` (default DAILY/1) strictly into the future (idempotent per occurrence).
  Session-less SYSTEM actor (`actorId: null`), no per-user scope — identical trust model to
  §7's worker. Invoked by `npm run automation:worker`
  (`scripts/run-automation-worker.ts`) AND `POST/GET /api/automation/run`
  (`src/app/api/automation/run/route.ts`), gated `Bearer CRON_SECRET` OR a CEO session.
- **Activity:** added `automation_ran` to `src/domain/activity.ts` (+ test) — renders
  `ran the automation "<name>"`.
- **Seeded example rules (idempotent), `prisma/seed.ts`** on the **Innovations** board:
  1. `When status → Done, add tag "shipped"` — trigger `status_changed` (config.to=DONE),
     action `add_tag` "shipped".
  2. `When priority → Urgent, post a comment` — trigger `priority_changed`
     (config.to=URGENT), action `post_comment`.
  Demoable from the existing board/detail UI with no builder.

## 3. Files added/changed
- `src/domain/automation.ts` + `automation.test.ts` — pure engine + vocabulary (NEW, TDD, 39 tests).
- `src/lib/automation.ts` — event-driven execution glue + loop-guard (NEW).
- `src/lib/automation.guard.test.ts` — loop-guard proof (NEW, 2 tests, mocks `@/lib/prisma`).
- `src/lib/automationTrigger.ts` — inline event hooks (NEW).
- `src/lib/automationWorker.ts` — scheduled (time-based) single-pass worker (NEW).
- `scripts/run-automation-worker.ts` — `npm run automation:worker` CLI (NEW).
- `src/app/api/automation/run/route.ts` — HTTP worker trigger, CRON_SECRET/CEO-gated (NEW).
- `src/app/board/actions.ts` — `onStatusChanged` hook in `changeStatusAction` (CHANGED).
- `src/app/board/task/actions.ts` — automation hooks across status/priority/assignee/due/tag (CHANGED).
- `src/domain/activity.ts` + `activity.test.ts` — added `automation_ran` (CHANGED, +1 test).
- `prisma/schema.prisma` + migration `20260629100312_automation_next_run_at` — added
  `AutomationRule.nextRunAt` (DateTime?, indexed) for the scheduled worker's clock (CHANGED, additive).
- `prisma/seed.ts` — two example automation rules on Innovations (CHANGED, idempotent).
- `vitest.config.ts` — added the `@/* → src/*` alias so lib tests resolve the alias (CHANGED).
- `package.json` — `automation:worker` script (CHANGED).
- `docs/handoffs/08-automation.md` — this file (CHANGED → PARTIAL).

## 4. State of the world
- **Migrations:** 3 applied. New: `20260629100312_automation_next_run_at` (single additive
  nullable column + index). `prisma validate` ok · `migrate status`: "up to date".
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`. Optional
  `CRON_SECRET` to let an external scheduler hit `/api/automation/run` (without it, only a
  CEO session may run it). Optional `SUPABASE_*` for attachments (degrades).
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in (`noel@halevora.com`/`halevora` CEO; `member1@halevora.com`/`halevora` MEMBER). Run
  the scheduled automation pass once with `npm run automation:worker`.
- **Verified (this session):**
  - `npm run typecheck` clean · `npm test` **205/205** (was 163; +42) · `npm run build`
    clean (`/api/automation/run` route present) · `prisma validate` + `migrate status` in
    sync · dev booted, no runtime errors.
  - **Engine integration (direct call):** on Innovations, a `status_changed → DONE` event ran
    the seeded rule → `shipped` tag added, 1 `success` run row + 1 `automation_ran` activity,
    other rules logged `skipped`/trigger_mismatch; a `priority_changed → URGENT` event posted
    the system comment (0→1); a non-matching `due_changed` event applied 0. No errors.
  - **Scheduled worker (direct call):** a due `scheduled` rule (past `nextRunAt`) → fired on
    all 3 board tasks, `nextRunAt` advanced to next-day midnight UTC (strictly future); a
    SECOND pass scanned 0 (idempotent).
  - **Loop-guard:** `automation.guard.test.ts` proves a self-re-triggering rule pair
    terminates at `MAX_AUTOMATION_DEPTH`; in the live smoke the cascade naturally stopped
    (the cascaded `add_tag` was elided as a no-op) — exactly 1 success row, no infinite loop,
    app stayed responsive.
  - **Browser (chrome-devtools), CEO=Noel:** marked "Research competitor pricing" DONE on the
    board → detail panel shows status **Done** + tag **shipped** (applied by the rule) and the
    activity `Noel Pollak ran the automation "When status → Done, add tag \"shipped\""`. A
    non-matching surface did nothing. **No console errors**; screenshot captured.
  - **Audits:** **PERMISSIONS AUDIT PASS** (0 leaks — every user-triggered hook is preceded by
    `findVisibleTask`; automation writes are the deliberate unscoped SYSTEM path; the
    scheduled pass + `/api/automation/run` are session-less/CRON_SECRET-or-CEO-gated, never a
    MEMBER). **RECURRENCE re-check OK** — recurrence files were NOT touched (the automation
    worker is parallel, not a modification of the shared worker); `recur:worker` still boots.
- **Smoke data reset:** the smoke task restored to seed (TODO, tags=[research]); all smoke
  run-log + `automation_ran` activity rows deleted; temp scripts removed. The 2 seed rules
  remain (idempotent seed).

## 5. Open issues / deferred
- **`scheduled` trigger semantics (v1):** a scheduled rule runs over EVERY non-archived
  top-level task on its board (conditions narrow which actually change). If product later
  wants per-task scheduling (e.g. "3 days before each task's due date"), extend the worker to
  compute a per-task `nextRunAt`; the schema/engine are structured for it.
- **`nextRunAt` is only set by the worker / a future 8b create action** — the seed rules are
  event-driven (no `nextRunAt`), so they are inert to the scheduled worker by design. 8b's
  rule-create action must compute an initial `nextRunAt` for a `scheduled` rule (mirror
  `setRecurrenceAction`'s `nextOccurrence` anchoring).
- **`assignee_changed` cascade** uses the changed user id only as event context; no condition
  field keys off the specific user beyond the `assignees` collection — sufficient for v1.
- **No realtime push** of an automation-applied change — it appears on the next board
  load/`router.refresh` (same as §7). §11 can emit a scoped board event.

## 6. NEXT SECTION (8b): Automation builder UI — depends on 8a (this), §3, §1
**Goal:** a per-board rule **builder UI** + CEO-gated, board-scoped server actions to
create/update/delete/reorder/enable rules, validating every saved rule against the 8a
vocabulary via `parseRule` (reject if it returns null or drops everything).

**Entry point / structure (match `DESIGN.md` + the `impeccable` skill; the §7
`RecurrenceSection` in `TaskPanelExtras.tsx` is the closest template):**
- A **rule list per board** (board settings / a board-level "Automations" surface): each row
  shows name, an enable/disable toggle, the trigger summary, and reorder handles
  (write `order`). Reuse `Modal.tsx` for create/edit.
- A rule editor: **trigger picker → condition rows → action rows**, plus name + enabled.
- **Server actions** (NEW file, e.g. `src/app/board/automation/actions.ts`): CEO-gated
  (`requireRole("CEO")`) and board-scoped; build the `trigger`/`conditions`/`actions` Json,
  run it through `parseRule` server-side before persisting (never trust the client shape),
  and for a `scheduled` trigger compute an initial `nextRunAt`. Append nothing to
  `AutomationRunLog` (that is the engine's job). Revalidate the board.

**The EXACT vocabulary 8b must render (from `src/domain/automation.ts`):**
- **Triggers** (`TRIGGER_TYPES`): `status_changed`, `assignee_changed`, `priority_changed`,
  `due_changed`, `tag_added`, `scheduled`.
  - `status_changed` / `priority_changed`: optional `config.to` (a Status / Priority) to pin
    the destination.
  - `tag_added`: optional `config.tag` (tag name) to pin which tag fires it.
  - `scheduled`: `config.cadence` ∈ {DAILY,WEEKLY,MONTHLY,YEARLY,CUSTOM} + `config.interval`
    (≥1, default DAILY/1).
- **Condition fields** (`CONDITION_FIELDS`): `status`, `priority`, `title`, `tags`,
  `assignees`, `dueAt`, `startAt`.
  **Operators** (`CONDITION_OPERATORS`): `equals`, `not_equals`, `contains`, `before`,
  `after`, `is_empty`, `is_not_empty`. (`before`/`after` apply to date fields with a
  YYYY-MM-DD value; `contains`/`equals` on `tags`/`assignees` mean membership; `is_empty`
  works on collections and date/scalar fields.) Group with `{ match:"all"|"any", conditions }`
  for AND/OR; a flat array is implicit AND.
- **Actions** (`ACTION_TYPES`): `set_status` {status}, `set_priority` {priority},
  `assign_user` {userId}, `unassign_user` {userId}, `add_tag` {tag}, `remove_tag` {tag},
  `post_comment` {text}. Actions are ordered; the engine elides no-ops at run time.

**Gotchas for 8b:**
- Validate the assembled rule with `parseRule` SERVER-SIDE before persisting; a client could
  POST any Json. Reject a rule whose trigger is unknown or whose actions all drop out.
- CEO-gate every rule mutation (`requireRole("CEO")`) and scope to the board.
- Do NOT re-implement engine logic in the UI — render the vocabulary, store Json, let the
  8a engine evaluate. Run `halevora-permissions-audit` + `halevora-qa-gate` before handoff.

## 7. What 8b built (Automation builder UI) — COMPLETE

A per-board, **CEO-only** builder UI that assembles + server-validates rule JSON and drives
the 8a engine. It renders EXACTLY the 8a vocabulary; no engine branching lives in the UI.

- **Builder surface, `/board/automation/[boardId]`** (full page, CEO-gated). Reached from a
  per-column **Automations** affordance (a bolt icon) in the board column header, shown to a
  CEO only (`src/app/board/Board.tsx`). The page is the same CEO redirect-gate shape as
  `/admin/users` (`currentActor()` → `redirect("/board")` for a non-CEO).
  - **Rule list:** name, an enable/disable toggle, the human-readable trigger→action summary,
    up/down reorder (writes `order`), Edit, Delete. A "Needs attention" pill flags any stored
    rule that no longer parses. Empty state teaches the feature.
  - **Rule editor** (inline, three numbered steps): **trigger picker** → **condition rows**
    (field × operator × value, add/remove, AND/OR match mode) → **action rows** (type + the
    relevant param, add/remove, ordered). The value/param control swaps by field/action type
    (status & priority dropdowns, people picker, date input, tag datalist, free text). The
    `status_changed` / `priority_changed` destination and the `scheduled` cadence/interval are
    rendered inline. Editing an existing rule re-hydrates the Draft from the stored JSON.
- **Pure summary helper (TDD), `src/domain/automationSummary.ts` (+ `.test.ts`, 13 tests).**
  `summarizeTrigger` / `summarizeCondition` / `summarizeAction(s)` turn the engine's
  discriminated-union vocabulary into the list's short sentences. Pure, defensive (a bad rule
  yields a safe fallback string), framework-free — LABELS only, never a fire decision.
- **CEO-gated, board-scoped server actions, `src/app/board/automation/actions.ts`:**
  `createRuleAction` / `updateRuleAction` / `toggleRuleAction` / `deleteRuleAction` /
  `reorderRuleAction`. EACH calls `requireRole("CEO")` as its first statement (throws
  `FORBIDDEN` for a member — server-enforced, not UI-hidden) and verifies the board exists.
  - **Server-side validation via the 8a engine.** `assembleAndValidate` builds the candidate
    in the SAME shape the DB stores, runs it through `parseRule`, and rejects it if `parseRule`
    returns null (unknown trigger) OR every action dropped out — the client JSON is never
    trusted. The raw (engine-blessed) JSON is what gets persisted.
  - **Scheduled clock.** For a `scheduled` trigger, `computeNextRunAt` sets the initial
    `nextRunAt` = first occurrence strictly after now (anchored on now, actor timezone) via the
    recurrence module's `nextOccurrence` — mirroring `setRecurrenceAction`. Event-driven
    triggers leave `nextRunAt` null. The actions append NOTHING to `AutomationRunLog` (that is
    the engine's job); they `revalidatePath` the board + rules page.
- **Data loader, `src/app/board/automation/data.ts`:** loads the board, its rules (engine
  run-order), and the user/tag pickers; pre-computes each rule's summary + a `valid` flag.
  Reads NO task data — the builder is board-level config, so there is no row-level task leak
  surface (permissions audit confirmed).

### 8b files added/changed
- `src/domain/automationSummary.ts` + `.test.ts` — pure summary/label helper (NEW, TDD, 13 tests).
- `src/app/board/automation/actions.ts` — CEO-gated create/update/delete/reorder/toggle; assembles + `parseRule`-validates; computes scheduled `nextRunAt` (NEW).
- `src/app/board/automation/data.ts` — board + rules + pickers loader (NEW).
- `src/app/board/automation/[boardId]/page.tsx` — CEO redirect-gated page (NEW).
- `src/app/board/automation/[boardId]/AutomationManager.tsx` — the client builder (list + editor) (NEW).
- `src/app/board/automation/[boardId]/automation.module.css` — dark-theme, token-only styles, all states + mobile (NEW).
- `src/app/board/Board.tsx` + `board.module.css` — per-column CEO-only Automations affordance (CHANGED).
- `src/app/board/page.tsx` — passes `isCeo` to `<Board>` (CHANGED).

### 8b verified (this session)
- `npm run typecheck` clean · `npm test` **218/218** (was 205; +13 summary tests, existing stay green) · `npm run build` clean (`/board/automation/[boardId]` route present) · `prisma validate` + `migrate status` in sync (NO new migration — 8b adds no schema).
- **Browser smoke (chrome-devtools), CEO=Noel, Client Success board:** built a rule via the
  builder (trigger `status_changed`→DONE, action `add_tag "shipped"`) → it persisted + appeared
  in the list with the correct summary. Marked a task DONE → the **8a engine applied the rule**:
  the `shipped` tag appeared on the task and the activity logged
  `Noel Pollak ran the automation "Tag shipped work when Done"` — proving the UI-built rule
  drives the engine end-to-end. Edited the rule (added a Priority condition, re-validated +
  saved). Toggled it **disabled** → marking another task DONE applied NO tag and logged no
  automation activity (disabled rule inert). Deleted it → back to the empty state. No console
  errors. Desktop + 390px mobile screenshots captured (editor stacks correctly).
- **Member-blocked (member1):** the Automations affordance is absent from the board, and direct
  navigation to `/board/automation/<id>` **redirects to /board** (server-enforced). Every action
  is additionally `requireRole("CEO")`-guarded (throws FORBIDDEN), so a member POST is rejected
  at the data layer, not merely hidden.
- **Permissions audit: PASS** (0 leaks) — CEO-only surface at both the page (redirect) and action
  (`src/app/board/automation/actions.ts:129` `const actor = await requireRole("CEO");`) layers;
  the builder reads NO task rows; **8a engine paths unchanged** (only the pure `automationSummary`
  helper is new in `src/domain`).
- **Smoke data reset to seed:** the two smoke tasks restored (Draft Q3 → IN_PROGRESS, tag removed;
  renewal → TODO); smoke `automation_ran` rows on Client Success deleted; Client Success has 0
  rules; the 2 seeded Innovations rules untouched.
