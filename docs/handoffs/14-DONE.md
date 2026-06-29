# Handoff 14 — v1 COMPLETE

Halevora Tasks v1 is done. Sections 0 through 13 are built, verified, and on `main`. This file is
the closing summary: what shipped, the final verified state, the security posture, and the backlog
the team consciously left for later.

## Sections 0–13: all complete

| # | Section | Status |
| --- | --- | --- |
| 0 | Scaffold + design system | DONE |
| 1 | Data model + migrations + seed | DONE |
| 2 | Auth + permissions (row-level scoping) | DONE |
| 3 | Board / Kanban core | DONE |
| 4 | Task detail A (status, dates, tags, description, subtasks, checklists) | DONE |
| 5 | Task detail B (custom fields, attachments, comments, activity) | DONE |
| 6 | Task dependencies | DONE |
| 7 | Recurring tasks | DONE |
| 8 | Automation builder (8a engine + 8b UI) | DONE |
| 9 | Views + sort/filter + calendar | DONE |
| 10 | Templates + bulk edit | DONE |
| 11 | Realtime + per-board chat | DONE |
| 12 | Notifications + @mentions + search | DONE |
| 13 | Polish (a11y, mobile, edge states, copy) | DONE |

## Final verified state

- **`npm run typecheck`** — clean, zero errors.
- **`npm test`** — **357 passing** (was 350 at the end of §12; +7 for the `moveTargets` position
  helper added in §13).
- **`npm run build`** — clean production build.
- **`npx prisma validate`** — schema valid.
- **`npx prisma migrate status`** — up to date, 5 migrations, in sync. §13 added no schema changes.
- **Browser smoke (chrome-devtools, CEO + member1):** the keyboard Move-to and calendar Reschedule
  paths work, the empty-board create affordance creates a board live, search/inbox ARIA is correct,
  and the board, task panel, and chat are usable at 390px. No console errors.

## What Section 13 changed

A quality pass across every surface. No new features, no schema changes.

- **Keyboard alternatives to drag-and-drop (the flagship a11y gap).** Board cards now carry a
  "Move to…" menu (top or bottom of any board column), and calendar tasks carry a "Reschedule…"
  date control. Both run through the same scoped, re-authorized server actions as the drag paths.
  The position logic is a pure, unit-tested helper (`src/domain/moveTargets.ts`).
- **Empty-board create affordance.** An empty board now shows a "Create a board" call to action, and
  a "+ Add board" column trails the grid at all times. Both call a new `createBoardAction` that
  re-authorizes server-side and resolves the project itself (never trusts a client id).
- **Error surfacing.** Failed server actions that the UI used to swallow now show a toast: the board
  move toast, the calendar reschedule toast, and a panel-level toast for every task-detail action
  (so the Done-gate refusal is visible instead of looking like nothing happened).
- **Focus management.** The task panel traps Tab and restores focus to its opener on close. The
  inbox panel and search overlay restore focus on close. The search overlay is a proper
  `combobox` + `listbox` with `aria-activedescendant`.
- **Mobile (390px).** The header tab row now scrolls internally so the search, bell, and user
  cluster stay pinned and reachable on a phone. Touch devices keep the move and reschedule handles
  visible (no hover to reveal them).
- **Copy.** Removed em dashes from user-facing strings, tightened empty-state and placeholder copy
  to active voice.

## Security: the five invariants hold (audit pass, 0 leaks)

Re-verified after the §13 data-path change (`createBoardAction`):

1. **Search is scoped.** member1 searching the CEO-only "Draft Q3 success playbook" got 0 results in
   the browser; the query composes `taskScopeWhere(actor)`.
2. **Notifications are per-recipient.** Every inbox read filters on `recipientId`; the live channel
   is the recipient's own.
3. **Realtime is leak-gated per subscriber.** The SSE relay authorizes each event before delivery.
4. **An @mention grants no task visibility.** It links to a surface that 404s if the recipient is
   not otherwise a viewer.
5. **Every mutation re-authorizes server-side.** `createBoardAction` calls `requireActor()` and
   resolves the project itself; it accepts only a board name from the client, no trusted ids.
   Creating a board is not a per-task read, so it is correctly unscoped (same rule as task create).
   A new board is empty, so it exposes no scoped data: a member sees the new column with zero cards.

Browser regression check: member1 still sees only assigned tasks on the board, the CEO-only tasks
stay hidden, the "All Tasks (CEO View)" tab and per-board automation links stay hidden for members.

## Consciously deferred (not v1)

Polish items left for a future pass (each was weighed and deferred, not missed):

- **Notification and chat pagination.** Both load a recent window with no scrollback.
- **Per-card live patch.** A task event triggers `router.refresh()` rather than patching one card.
- **Presence snapshot on connect.** A late joiner does not learn who is already present.
- **Postgres full-text search.** Title match is a SQL `contains`; description match ranks an
  in-memory window. A `tsvector` index is the scale-up path.
- **Notification preferences / digest.** Every qualifying event notifies; no per-user mute.
- **Comment @mention chips.** Chat chips mentions; comments still render `@handle` as plain text. A
  Tiptap mention node is the follow-up. Notifications for comment mentions already work.

From the original v1 backlog in `00-START-HERE.md` (out of scope by design):

- Time-tracking stopwatch, WIP limits, watchers/followers, a separate installable offline PWA (the
  web app is mobile-responsive), and a deeper custom-fields engine beyond the types v1 ships.

## Where things live

- Spec and section map: `docs/handoffs/00-START-HERE.md`.
- Per-section build history: `docs/handoffs/01` through `13`.
- Product and design intent: `PRODUCT.md`, `DESIGN.md`, `src/styles/tokens.css`.
- Run instructions and seeded logins: `README.md`.
