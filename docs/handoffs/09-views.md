# Handoff 09 — Views + sort/filter   (status: NOT STARTED — entry point for the next chat)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` — the spec (esp. §4 load-bearing decisions, §5 scope, the
  §6 dependency table: Section 9 depends on **§3** Board core).
- this file.
- Files Section 9 reads/edits:
  - **Scoping (REUSE, do not reinvent):** `src/lib/scope.ts` (`taskWhereForCurrentUser()`,
    `currentActor()`, `requireActor()`) + `src/domain/scope.ts` (the pure `taskScopeWhere`
    where-builder). EVERY task read in a view MUST compose `taskWhereForCurrentUser()` —
    CEO sees all, a MEMBER sees only assigned tasks. This is the load-bearing invariant.
  - **Board data loader as the model:** `src/app/board/data.ts` (`loadBoard`) shows the exact
    scoped-read idiom + the `BoardCard` shape (status, priority, dates, assignees, blockers).
  - **Status/derived-overdue:** `src/domain/status.ts` (`isOverdue`, `isClosed`),
    `src/domain/statusGroups.ts` (`badgeFor`, `STATUS_GROUPS`), `src/domain/priority.ts`
    (`comparePriority`) — overdue is DERIVED, never stored.
  - **Nav shell (wire the tabs):** `src/components/AppShell.tsx` already has Board / My Tasks /
    Calendar / Chat tabs; My Tasks + Calendar are placeholder routes
    (`src/app/my-tasks/page.tsx`, `src/app/calendar/page.tsx` render `@/components/Placeholder`).
  - **Date helpers:** `src/domain/dates.ts` (`formatInZone`, zone↔UTC midnight), used by the
    calendar + Today views (store UTC, render per-user timezone).
  - reference: `PRODUCT.md`, `DESIGN.md`, the `impeccable` skill, and the source screenshots
    in `C:\Users\david\Downloads\Noel` (the views/tabs + the date-picker quick choices).

## 2. What Section 8 built (engine + builder) — context for §9
Section 8 is COMPLETE. It is the **automation** feature and does not block §9; §9 only needs
the scoped-read idiom Sections 3–7 established.
- **8a (engine):** a pure trigger/condition/action rules engine (`src/domain/automation.ts`),
  event-driven + scheduled execution glue (`src/lib/automation.ts`, `automationWorker.ts`),
  inline hooks, an append-only run log, and a loop-guard. See handoff 08 §2.
- **8b (builder UI):** a per-board, **CEO-only** builder at `/board/automation/[boardId]`
  (rule list + trigger/condition/action editor) reached from a column-header affordance. Its
  server actions assemble + server-validate rule JSON via the 8a engine's `parseRule` and are
  each `requireRole("CEO")`-gated. See handoff 08 §7. **§9 does not touch automation.**

## 3. Files added/changed in Section 8 (8b portion)
- `src/domain/automationSummary.ts` + `.test.ts` — pure trigger/condition/action summary helper (NEW).
- `src/app/board/automation/actions.ts` — CEO-gated, `parseRule`-validated rule mutations (NEW).
- `src/app/board/automation/data.ts` — board + rules + pickers loader (NEW).
- `src/app/board/automation/[boardId]/page.tsx` — CEO redirect-gated builder page (NEW).
- `src/app/board/automation/[boardId]/AutomationManager.tsx` — client builder (list + editor) (NEW).
- `src/app/board/automation/[boardId]/automation.module.css` — token-only dark styles + mobile (NEW).
- `src/app/board/Board.tsx` + `board.module.css` — CEO-only per-column Automations affordance (CHANGED).
- `src/app/board/page.tsx` — passes `isCeo` to `<Board>` (CHANGED).

## 4. State of the world (verified at the close of Section 8)
- **Migrations:** 3 applied; `prisma validate` ok, `migrate status` "up to date". Section 8
  added NO new migration (8b is UI-only). §9 is expected to need **no schema change** for the
  core views, but **custom/saved views** (a "Saved view" entity: name, owner, filter/sort JSON,
  scope) WILL need a new model + migration — plan that as the one additive migration of §9.
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY` (+ optional
  `CRON_SECRET`, `SUPABASE_*`). Nothing new for §9.
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in `noel@halevora.com`/`halevora` (CEO) or `member1@halevora.com`/`halevora` (MEMBER).
- **Verified:** `npm run typecheck` clean · `npm test` **218/218** green · `npm run build` clean
  · app boots, no runtime/console errors · automation builder drives the engine end-to-end +
  member-blocked (handoff 08 §7) · permissions audit PASS.

## 5. Open issues / deferred
- **No realtime push** of a view after a mutation elsewhere — views reflect on load /
  `router.refresh` (same as the board). §11 (realtime) can add live updates; §9 should not.
- **Automation `scheduled` semantics** stay per-board (handoff 08 §5) — unrelated to §9.
- The placeholder `src/app/chat/page.tsx` stays a placeholder until §11 (per-board chat).

## 6. NEXT SECTION (9): Views + sort/filter — depends on §3 (Board core)
**Goal:** the saved/standard views over the scoped task set, the calendar, the fast-entry
view, and multi-sort + quick filters — all reads row-level scoped via
`taskWhereForCurrentUser()`. Wire the placeholder nav tabs to real routes.

**Build (from `00-START-HERE.md` §5 + the `C:\Users\david\Downloads\Noel` screenshots):**
- **My Tasks** (`/my-tasks`): the current user's assigned, open tasks across all boards
  (already scoped — for a CEO that is "tasks assigned to me", distinct from All-CEO below).
- **All-CEO** view: every task across boards (CEO only — gate like the automation page).
- **Today**: tasks due today (per-user timezone via `src/domain/dates.ts`) + derived overdue.
- **Reviewed**: the REVIEWED tasks that left the board grid (the board excludes them; this view
  surfaces them).
- **Calendar** (`/calendar`): week + day views, tasks placed by due date; **drag a task to a
  date** to reschedule (reuse the board's drag idiom + a `setDateAction`-style mutation, scoped
  + re-authorized). The date-picker quick choices (Today / Later / Tomorrow / This weekend /
  Next week / 2 weeks / 4 weeks) are part of the one-to-one ClickUp match — see the screenshots.
- **Add Tasks Quickly** fast-entry view: an enter-to-create-many composer (create a task, keep
  focus, create the next) — mirror the board `AddTask` composer's keep-open behavior, batched.
- **Multi-sort** (status, priority via `comparePriority`, due date, title) + **quick filters**
  (by status, priority, assignee, has-due, overdue) — keep the sort/filter logic PURE in
  `src/domain` (TDD) and apply it to the already-scoped result set.
- **Custom / saved views + a Quick view** ("Add view"): persist a named view (owner-scoped) with
  its filter+sort JSON. This needs the one additive migration noted in §4.

**Entry point / first 3 steps:**
1. Read `src/app/board/data.ts` (`loadBoard`) and `src/lib/scope.ts` to internalize the scoped
   read idiom, then build a small pure `src/domain/views.ts` (sort comparators + filter
   predicates over a task shape) with tests FIRST (TDD), reusing `comparePriority` / `isOverdue`.
2. Wire `/my-tasks` and `/calendar` from placeholders to real server pages that load
   `taskWhereForCurrentUser()`-scoped tasks and render the view (mirror the board page's
   redirect-if-unauthenticated gate; All-CEO additionally `role !== "CEO"` → redirect).
3. Add the saved-view model + migration, the "Add view" UI, and the multi-sort/quick-filter
   controls; verify with a two-account (CEO vs MEMBER) browser check that a MEMBER never sees a
   task they aren't assigned to in ANY view.

**Gotchas:**
- **Every** task read composes `taskWhereForCurrentUser()` — including the calendar fetch, the
  Today/Reviewed queries, and any saved-view query. A bare `prisma.task.findMany` in a view is a
  release blocker (run `halevora-permissions-audit` before the handoff).
- Overdue + Today are **derived** in the actor's timezone (`src/domain/dates.ts`); never store
  overdue, never compare in server-UTC for a "today" bucket.
- Drag-to-date reschedule must re-authorize the task (`findVisibleTask`-style) before writing —
  never trust the dragged id. Reuse the existing date mutation; do not add a second one.
- Match `DESIGN.md` (dark, tokens only, the form-control + button vocabulary) and the `impeccable`
  skill; the screenshots in `C:\Users\david\Downloads\Noel` are the layout ground truth.
- Validate: `npm run typecheck` + `npm test` (keep 218 green, add view tests) + `npm run build`
  + a focused browser check, then run `halevora-qa-gate` + `halevora-permissions-audit`.
