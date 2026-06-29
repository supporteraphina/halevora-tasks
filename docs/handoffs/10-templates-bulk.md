# Handoff 10 — Templates + bulk edit   (status: NOT STARTED — entry point for the next chat)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` — the spec (esp. §4 load-bearing decisions, §5 scope;
  Section 10 depends on **§9** Views).
- this file.
- Files Section 10 reads/edits:
  - **Scoping (REUSE, never reinvent):** `src/lib/scope.ts`
    (`taskWhereForCurrentUser()`, `currentActor()`, `requireActor()`, `requireRole()`) +
    `src/domain/scope.ts` (`taskScopeWhere`). EVERY task read composes the scope fragment;
    every per-task mutation re-authorizes via a `findVisibleTask`-style scope re-check.
  - **The re-auth gate to copy:** `findVisibleTask` in `src/app/board/task/actions.ts` (and
    the twin in `src/app/board/actions.ts`). Batch mutations must re-authorize EACH task in
    the batch through this gate — never trust a client-supplied id list.
  - **Templates model (already in schema):** `TaskTemplate { id, boardId?, name, description?,
    data Json, createdById?, ... }` in `prisma/schema.prisma` — `data` is the task blueprint
    (title, description, checklists, fields, …). No migration needed to start.
  - **The §9 view UI to extend with multi-select:** `src/app/views/ListView.tsx` (the list
    rows) + `src/app/board/Board.tsx` (the board cards). Add selection state + a batch action
    bar; reuse the toolbar/popover vocabulary in `src/app/views/views.module.css`.
  - **The scoped list loader:** `src/app/views/data.ts` (`loadScopedTasks`) — the batch
    surfaces read through it.
  - reference: `PRODUCT.md`, `DESIGN.md`, the `impeccable` skill, and the screenshots in
    `C:\Users\david\Downloads\Noel`.

## 2. What Section 9 built (Views + sort/filter) — context for §10
Section 9 is COMPLETE. It added the saved/standard views, the calendar, fast-entry, and
multi-sort + quick filters — all row-level scoped.
- **Pure domain (TDD):**
  - `src/domain/views.ts` — `buildComparator` (multi-key sort over status/priority/dueAt/
    title/createdAt; nulls-last for dueAt), `matchesFilter`/`filterTasks` (status, priority,
    assignee, tag, has-due, overdue; empty facet = no constraint), `applyView`, and the
    defensive saved-config parsers `parseFilter`/`parseSort`/`parseViewConfig`. Reuses
    `comparePriority`/`priorityRank` and `isOverdue`. **30 tests.**
  - `src/domain/calendar.ts` — month/week/day grid math (`monthGrid` 6×7, `weekGrid`,
    `addDays`/`addMonths` with day-clamp, `stepAnchor`, `periodLabel`, `dayKey`). **All
    calendar days are the actor's LOCAL calendar; the page derives them from UTC via
    `src/domain/dates.ts`.** **~20 tests.**
  - `src/domain/dates.ts` — added `isSameDayInZone` (Today bucketing in the actor's tz).
- **Views (all `force-dynamic`, all redirect-if-unauthenticated):**
  - `/my-tasks` — assigned-to-me across boards (grouped by board).
  - `/all-tasks` — **CEO-only**, server-gated (`role !== "CEO"` → redirect `/my-tasks`).
  - `/today` — due on the actor's local day OR still-open overdue (derived in tz).
  - `/reviewed` — the REVIEWED tasks that left the board (`onlyReviewed`).
  - `/calendar` — month/week/day + **drag-a-task-to-a-day** to reschedule its due date.
  - `/add-tasks` — fast-entry: type + Enter creates into a chosen board, input stays focused.
- **Multi-sort + quick filters** live in the shared client `src/app/views/ListView.tsx`
  (Sort builder popover, Filter facet popover) and apply the pure `applyView` over the
  already-scoped set. The board (§3) was NOT retrofitted with the toolbar — §10/§13 can if
  wanted; the spec's sort/filter requirement is satisfied on the list views.
- **Saved / custom views ("Add view") + a Quick view:** the new **`SavedView`** model
  (owner-scoped) persists `{ filter, sort }` JSON + a `kind`. Chips under each view let you
  reopen (`?view=<id>`) or delete a saved view. Migration: **`20260629104307_saved_views`**.

## 3. Files added/changed in Section 9  (path — one line)
**Pure domain (new):**
- `src/domain/views.ts` + `.test.ts` — sort comparator + filter predicates + config parsers.
- `src/domain/calendar.ts` + `.test.ts` — month/week/day grid math (local-calendar).
- `src/domain/dates.ts` + `.test.ts` (CHANGED) — added `isSameDayInZone`.

**Shared view infra (new, under `src/app/views/`):**
- `data.ts` — `loadScopedTasks` (THE scoped task loader for every list/calendar view),
  `loadFilterOptions`, `loadBoardOptions`.
- `savedViews.ts` — owner-scoped saved-view reads (`loadSavedViews`, `loadSavedView`,
  `VIEW_KINDS`).
- `actions.ts` — `createSavedViewAction`/`renameSavedViewAction`/`deleteSavedViewAction`
  (owner-scoped), `rescheduleTaskAction` (delegates to `setDateAction`), `quickCreateTaskAction`
  (delegates to `createTaskAction`).
- `ListView.tsx` — the shared list UI: Sort builder, Filter facets, saved-view chips, rows.
- `views.module.css` — token-only dark styles + mobile.

**View pages (new / wired from placeholders):**
- `src/app/my-tasks/page.tsx` (CHANGED from placeholder), `src/app/all-tasks/page.tsx` (NEW,
  CEO-gated), `src/app/today/page.tsx` (NEW), `src/app/reviewed/page.tsx` (NEW).
- `src/app/calendar/page.tsx` (CHANGED) + `CalendarView.tsx` + `calendar.module.css` (NEW).
- `src/app/add-tasks/page.tsx` + `FastEntry.tsx` (NEW).

**Wiring + schema:**
- `src/components/AppShell.tsx` (CHANGED) — tabs now Board · My Tasks · Add Tasks Quickly ·
  All Tasks (CEO View, CEO-only) · All Tasks TODAY · Reviewed · Calendar · Chat.
- `prisma/schema.prisma` (CHANGED) — added `SavedView` model + `User.savedViews` relation.
- `prisma/migrations/20260629104307_saved_views/` (NEW).

## 4. State of the world (verified at the close of Section 9)
- **Migrations:** 4 applied; `prisma validate` ok, `migrate status` "up to date".
- **Env needed:** unchanged (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`).
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in `noel@halevora.com`/`halevora` (CEO) or `member1@halevora.com`/`halevora` (MEMBER).
- **Verified:** `npm run typecheck` clean · `npm test` **267/267** green (was 218; +49) ·
  `npm run build` clean (all 7 new routes present) · app boots, **no console errors**.
- **Browser smoke (clicked):** as Noel (CEO) — My Tasks/All-Tasks/Today/Reviewed/Calendar
  render; multi-sort (Status clause) + quick filter (Overdue: 7→1 task) work; saved a custom
  view "Overdue across boards" and reopened it (`?view=…`); calendar Month/Week/Day all
  render; **dragged a task from Jun 28 → Jul 9 and the reschedule persisted** (and the task
  stopped reading as overdue); Add Tasks Quickly created 3 tasks via Enter with the input
  staying focused. As Team Member 1 (MEMBER) — **All Tasks tab hidden AND `/all-tasks`
  redirects to `/my-tasks` server-side**; My Tasks/Calendar show ONLY their 3 assigned tasks
  (no Noel/T2/T3 tasks leaked). Desktop + 390px mobile screenshots captured, no console errors.
- **Permissions audit:** PASS — every task read is `loadScopedTasks` (composes
  `taskWhereForCurrentUser()`); the only `prisma.task.findMany` in a view is
  `src/app/views/data.ts` (scoped); saved-view CRUD is all `ownerId: actor.userId`-scoped;
  drag-to-date + fast-create delegate to the re-authorizing `setDateAction`/`createTaskAction`;
  All-CEO is role-gated at `src/app/all-tasks/page.tsx`.
- **Seed:** QA-created tasks removed and the dragged task's due date restored after testing.

## 5. Open issues / deferred (with code TODO markers)
- **No realtime push** — views reflect on load / `router.refresh` (same as the board). §11
  (realtime) can add live updates; §9 deliberately did not.
- **Board (§3) toolbar:** the multi-sort/quick-filter toolbar lives on the LIST views, not the
  Kanban board. Adding it to the board is optional polish (not required by §5); a §10/§13
  follow-up could lift `ListView`'s controls onto `Board.tsx`.
- **Saved-view rename:** `renameSavedViewAction` exists and is owner-scoped but is not yet
  wired to a UI control (only create/delete are surfaced as chips). Trivial to add a rename
  affordance later.
- **Calendar drag** uses native HTML5 DnD (matches the board's idiom). No keyboard reschedule
  yet — open the task detail date picker for a11y. Flag for §13 (include).

## 6. NEXT SECTION (10): Templates + bulk edit — depends on §9
**Goal:** reusable task templates (create-from-template + save-as-template) AND multi-select +
batch mutations on the board/list views. All scoped + re-authorized per task in the batch.

**Build (from `00-START-HERE.md` §5):**
- **Templates:** the `TaskTemplate` model already exists (`data` Json blueprint). Build:
  - **Create-from-template UI** — pick a template, choose a target board, spawn a task with the
    blueprint's checklists/custom-field values/etc. materialised. The create must authorize the
    target board (reuse the `createTaskAction` pattern: verify board, auto-assign the creator
    so a MEMBER can see it).
  - **Save-as-template** — from an existing visible task, snapshot its blueprint into a
    `TaskTemplate` (re-authorize the task via `findVisibleTask` first). Decide CEO-only vs
    any-member for template authoring (the board schema / custom-field defs are CEO-only today
    — see `createCustomFieldAction` `requireRole("CEO")`; mirror that if templates carry field
    defs).
  - Keep the blueprint (de)serialization PURE in `src/domain/` (e.g. `templates.ts`) with TDD —
    parse untrusted `data` Json defensively, exactly like `parseViewConfig` in
    `src/domain/views.ts`.
- **Multi-select + batch edit:** add selection state to `src/app/views/ListView.tsx` rows and
  `src/app/board/Board.tsx` cards (checkbox affordance + a sticky batch-action bar). Batch
  mutations: **set status / priority / assignee / tag / archive** over the selected ids.
  - Implement as ONE server action per batch op that loops the id list and re-authorizes EACH
    task via the `findVisibleTask` gate before mutating (a member must be able to see every
    task they batch-edit; never trust the client id list). Reuse the existing single-task
    mutations' logic (status Done-gate, automation/recurrence hooks) where it applies — do not
    bypass the Done-gate in a batch close.

**Entry point / first 3 steps:**
1. Read `src/app/board/task/actions.ts` (`findVisibleTask`, `setStatusAction`,
   `setPriorityAction`, `toggleAssigneeAction`, `createSubtaskAction`) and `src/domain/views.ts`
   (the defensive-parse pattern). Build a pure `src/domain/templates.ts` (blueprint parse +
   materialise plan) with tests FIRST.
2. Add the create-from-template + save-as-template server actions (scoped + re-authorized) and
   a small UI entry (a "Templates" affordance on the board column header or a task detail menu).
3. Add multi-select to `ListView.tsx` + `Board.tsx` and the per-op batch server actions, each
   re-authorizing every id in the batch; verify with a two-account (CEO vs MEMBER) browser check
   that a MEMBER cannot batch-mutate a task they aren't assigned to (the action must skip/refuse
   the unseen ids, not 500).

**Gotchas:**
- **Every** task read still composes `taskWhereForCurrentUser()`; **every** batch mutation
  re-authorizes EACH id via `findVisibleTask`. A bare `prisma.task.updateMany({ where: { id:
  { in: ids } } })` WITHOUT a per-id scope re-check is a release blocker (run
  `halevora-permissions-audit` before the handoff).
- Archive is **soft-delete only** (`Task.archivedAt`) — never hard-delete (handoff 00 §5).
- The Done-gate (blocked-by-open-dependency) must hold in a batch close, just like the
  single-task path (`countOpenBlockers`).
- Templates' `data` Json is UNTRUSTED on read — parse defensively (mirror `parseViewConfig`).
- Match `DESIGN.md` (dark, tokens only) + the `impeccable` skill; reuse the §9 toolbar/popover
  + Modal vocabulary. Validate: `npm run typecheck` + `npm test` (keep 267 green, add template
  + batch tests) + `npm run build` + a browser check, then `halevora-qa-gate` +
  `halevora-permissions-audit`.
