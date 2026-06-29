# Handoff 04 — Task detail A (Section 4 entry)   (Section 3 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (project spec, scope, partition; esp. §4 two load-bearing
  decisions and §5 v1 scope)
- this file
- files Section 4 edits/reads:
  - `src/app/board/data.ts` — the scoped board loader (Section 4 opens a card from this grid)
  - `src/app/board/Board.tsx` — the card UI (the card becomes the click target that opens detail)
  - `src/app/board/actions.ts` — server-action idioms + `findVisibleTask` re-auth gate to reuse
  - `src/lib/scope.ts` (`taskWhereForCurrentUser`, `requireActor`) + `src/domain/scope.ts`
    (`taskScopeWhere`, `canSeeTask`) — compose into EVERY new Task read/mutation
  - `src/domain/status.ts`, `src/domain/statusGroups.ts` (grouped dropdown + `badgeFor`),
    `src/domain/priority.ts`, `src/domain/ordering.ts`
  - `prisma/schema.prisma` (Task has `description Json` (Tiptap), `startAt`, `dueAt`,
    `timeEstimate`, `Checklist`/`ChecklistItem`, `Tag`/`TaskTags`, subtasks via `parentId`)
  - `src/styles/tokens.css` (dark OKLCH tokens; status + priority vars already defined)
- reference: `PRODUCT.md`, `DESIGN.md`, and the date/recurrence picker screenshot
  `C:\Users\david\Downloads\Noel\WhatsApp Image 2026-06-29 at 00.43.09.jpeg`

## 2. What Section 3 built (Board view / Kanban core)
Boards-as-columns Kanban: the project's boards render as horizontally-scrolling columns, with
tasks as cards inside their board's column. Every Task read is row-level scoped to the current
user (CEO all; MEMBER only assigned). Overdue is derived at render, never stored.

- **Scoped board loader** (`src/app/board/data.ts`): workspace → first project → boards
  (`Board.order`, `archivedAt:null`). For each board, a SCOPED card read:
  `where: { AND: [ scopeWhere, { boardId, parentId:null, archivedAt:null, status:{ not:REVIEWED } } ] }`
  ordered by `Task.order`, selecting assignees + a subtask `_count`. `scopeWhere` is
  `await taskWhereForCurrentUser()` resolved once. REVIEWED leaves the grid (Reviewed view = §9).
- **Pure domain (TDD, +22 tests):**
  - `src/domain/ordering.ts` — fractional drag-reorder: `appendOrder`, `midpoint`,
    `orderForMove(neighbors, index)`, `needsRenormalize`, `renormalize`. `ORDER_STEP = 1000`.
    A reorder is one row write (a midpoint); a collision triggers a column renormalize.
  - `src/domain/statusGroups.ts` — `STATUS_GROUPS` (Not started / Active / Done / Closed over
    the four STORED statuses; OVERDUE is never selectable), `STATUS_LABELS`, and
    `badgeFor(task, now)` which returns a derived `OVERDUE` badge or the stored status.
- **Server actions** (`src/app/board/actions.ts`), each authorized server-side:
  - `createTaskAction` — creates into a board (default `status:TODO`, `order = appendOrder(max)`),
    auto-assigns the creator so a MEMBER sees the card they just made. Verifies the board exists.
  - `changeStatusAction` — writes only TODO/IN_PROGRESS/DONE/REVIEWED (never OVERDUE).
  - `moveCardAction` — changes `boardId` and/or `order`. Uses `orderForMove`; renormalizes the
    destination column in a `$transaction` when orders collide.
  - All three re-authorize via `findVisibleTask(taskId)`, which re-queries the task under
    `taskScopeWhere(actor)` — a client task id is never trusted. A foreign id returns null →
    "Task not found." (IDOR-safe by construction.)
- **UI** (`src/app/board/Board.tsx` + `board.module.css`, dark, tokens-only): breadcrumb
  "Team Space / Halevora" + left Projects rail (in `page.tsx`); column header = color dot +
  name + count; card = title, grouped status badge (ClickUp-style dropdown), priority flag,
  overlapping assignee-initial avatars, due date with red Overdue treatment, "N subtasks"
  count; per-column "+ Add Task" inline composer (Enter-to-save, stays open for fast entry);
  native HTML5 drag-and-drop with an insertion indicator. Mobile: rail hidden, columns ~85vw.

## 3. Files added/changed
- `src/app/board/page.tsx` — replaced placeholder: server component, breadcrumb + Projects rail,
  renders `<Board>`; `dynamic = "force-dynamic"`; redirects unauthenticated to `/login` (CHANGED).
- `src/app/board/data.ts` — scoped board loader returning columns + scoped cards (NEW).
- `src/app/board/actions.ts` — create / change-status / move server actions, `findVisibleTask`
  re-auth gate (NEW).
- `src/app/board/Board.tsx` — client board: columns, cards, grouped status dropdown, drag-and-drop,
  add-task composer (NEW).
- `src/app/board/board.module.css` — board / column / card / badge / dropdown / composer styles (NEW).
- `src/domain/ordering.ts` + `ordering.test.ts` — fractional ordering helpers (NEW, TDD).
- `src/domain/statusGroups.ts` + `statusGroups.test.ts` — grouped dropdown + `badgeFor` (NEW, TDD).
- `docs/handoffs/03-board-kanban.md` — corrected-model (boards-as-columns) update (CHANGED, pre-session).

## 4. State of the world
- **Migrations:** unchanged — `20260629020818_init_data_model` only. Section 3 added NO column
  and NO migration. `npx prisma validate` ok; `npx prisma migrate status` → "up to date".
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET` (all in gitignored `.env`).
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`,
  then `/login`. Seeded logins (password `halevora`): `noel@halevora.com` (CEO),
  `member1@halevora.com`..`member3@halevora.com` (MEMBER).
- **Verified (ran/clicked this session):**
  - `npm run typecheck` clean · `npm test` 47/47 (was 25; +22 in ordering/statusGroups) ·
    `npm run build` clean (9 routes + Proxy) · `npx prisma validate` ok · `migrate status` in sync.
  - **Browser smoke (chrome-devtools MCP), logged in as Noel (CEO):** board renders
    boards-as-columns (Innovations 3 · Client Success 2 · Meta Ads 2); REVIEWED seed task
    excluded; status badges correct tones; **derived OVERDUE** shown on "Follow up with overdue
    renewal" (due yesterday, stored TODO) with red due-date treatment; breadcrumb + Projects rail
    present (rail hidden below 640px). Created "QA smoke test task" (persisted across reload,
    auto-assigned to creator); changed its status TODO→IN_PROGRESS (persisted); dragged it
    Innovations→Meta Ads (boardId move persisted); reordered it to the top of Meta Ads (order
    persisted); marked it REVIEWED → removed from grid (persisted). No console errors.
  - **Member isolation (logged in as member1):** Client Success shows **0** cards (Noel's tasks
    hidden), Innovations 2 (only T1-assigned), Meta Ads 1 — NO cross-member leak. No Admin link
    (Member role). No console errors.
  - Screenshots saved to the session scratchpad (desktop wide, status dropdown, member1 view,
    390px mobile) — outside the repo.
  - QA smoke task deleted afterward; DB back to 8 seed tasks. `.env` not tracked (`git check-ignore`
    confirms); no `proxies.txt`/secrets staged.
  - **Permissions audit (`halevora-permissions-audit`):** all 7 `prisma.task.*` call sites
    reviewed — VERDICT **AUDIT PASS**. Every content-bearing read composes the scope fragment
    (`data.ts` grid read; `findVisibleTask` gate). The two UNSCOPED reads (`aggregate _max:order`
    on create; `findMany select:{id,order}` for move neighbors) return only ordering numbers
    server-side, never task content, and never reach the client — documented trade-off so card
    positions stay globally consistent across viewers. Every mutation re-authorizes via
    `findVisibleTask`. No task reads exist outside `src/app/board/`.

## 5. Open issues / deferred (with code TODO markers)
- **Card has no detail panel yet** — clicking a card does nothing; the title/badge/avatars are
  display-only. Section 4 makes the card open a detail view. (No TODO marker; this is the §4 task.)
- **Drag-and-drop is native HTML5** (no library). Keyboard-accessible reordering is NOT
  implemented — a keyboard user can change status (the dropdown is keyboard-operable) but cannot
  reorder/move cards. Consider a "Move to…" menu or dnd-kit in Polish (§13).
- **Subtasks show only a count.** The detail panel (§4) lists/creates them. A subtask is visible
  per its OWN assignees (scope applies per-row).
- **`requireActor`/`requireRole` still throw plain `Error`.** Board actions call `requireActor`
  inside server actions and surface a returned `{error}` string, not a thrown 500 — but if §4
  adds a route handler, map those throws to 401/403.
- **No empty-board "create a board" affordance** — the grid renders existing boards only; board
  CRUD is out of §3 scope. An empty project shows "No boards in this project yet."
- **`order` renormalize is per-move, reactive** — there is no background sweep; collisions are
  handled on the next move into that column. Fine for v1 volumes.

## 6. NEXT SECTION (Section 4): Task detail A

**Goal:** clicking a card opens a **task detail** surface (panel or route) exposing the
single-task editing ClickUp shows: **status** (reuse the grouped dropdown), **assignees**
(add/remove people — remember a MEMBER unassigning themselves removes their own visibility),
**start + due dates** with a **ClickUp-style calendar/date picker** (quick choices Today /
Tomorrow / This weekend / Next week / 2 weeks / 4 weeks, per the screenshot), **priority**,
**tags**, a **Tiptap rich-text description** with an **AI-assisted writing prompt** (Claude —
read the `claude-api` skill before wiring any model call; do NOT hardcode a model id from
memory), **subtasks** (create/list — they are Tasks with `parentId` set), and **checklists**
(`Checklist` + `ChecklistItem`). Every read/mutation stays **row-level scoped** and
**re-authorized server-side** (reuse `findVisibleTask` / compose `taskWhereForCurrentUser`).

**Entry point:** make the `Card` in `src/app/board/Board.tsx` open the detail (a `/board`
modal/panel, or a `src/app/task/[id]/` route — pick one; the panel keeps board context). Load
the task with a SCOPED read (`{ AND: [ taskWhereForCurrentUser(), { id, archivedAt:null } ] }`)
including assignees, tags, subtasks (own scope), checklists, and `description`.

**First 3 steps:**
1. Add the scoped single-task loader + the open-on-click wiring (panel or route). Reuse
   `badgeFor`/`STATUS_GROUPS` for the status control and `findVisibleTask` for every mutation.
2. Build the field editors as server-action forms (idiomatic `useActionState`, like
   `board/actions.ts` and `admin/users`): assignees (people picker over `User`), priority,
   tags (connect/disconnect `Tag`), start/due via the calendar picker, time estimate.
3. Tiptap description (deps already installed: `@tiptap/react`, `@tiptap/starter-kit`,
   `@tiptap/pm`) persisted to `Task.description Json`; an "AI-assist" button that drafts/expands
   copy via a Claude call (consult `claude-api` skill first). Then subtasks + checklists CRUD.

**Gotchas:**
- **Scope every new read** (the task, its subtasks, anything that returns task content) and
  **re-authorize every mutation** via `findVisibleTask` — a card id from the client is untrusted.
  Run `halevora-permissions-audit` after §4 (new read surface).
- **Assignee edits change visibility**: removing the last assignee a MEMBER shares makes the card
  vanish from their board; the CEO still sees it. Don't let a MEMBER orphan a task out of their
  own view by accident without it being intended behavior.
- **Dates are UTC-stored, per-user rendered** — the picker writes UTC; render in the actor's
  `timezone` (already on the session). Overdue stays derived (`isOverdue`), never stored.
- **Subtasks are Tasks** — create with `parentId` set, `boardId` inherited; they do NOT appear in
  the board grid (grid filters `parentId:null`), only in the detail panel and the card count.
- **Don't hardcode a Claude model id** — read the `claude-api` skill; pricing/model ids change.
- Run `halevora-qa-gate` before the §5 handoff; browser-smoke the detail panel with a CEO and a
  MEMBER account.
