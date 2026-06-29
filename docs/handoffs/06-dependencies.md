# Handoff 06 — Task dependencies (Section 6 entry)   (Section 5 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (spec; §4 load-bearing decisions, §5 scope)
- this file
- files Section 6 edits/reads:
  - `prisma/schema.prisma` — `TaskDependency` (single directed edge `blocker → blocked`)
  - `src/domain/scope.ts`, `src/lib/scope.ts` — scoping (compose into every read)
  - `src/app/board/task/actions.ts` — the `findVisibleTask` re-auth gate; the status-change
    action (`setStatusAction`) is where the **Done-gate** must be enforced
  - `src/app/board/task/data.ts` — the scoped detail loader (add the task's dependency edges)
  - `src/app/board/task/TaskPanel.tsx` / `TaskPanelExtras.tsx` — detail UI to extend
  - `src/app/board/Board.tsx` — card, for a "blocked" indicator
  - `src/lib/activity.ts` — emit activity on link add/remove
  - `src/domain/status.ts` (`isClosed`) — a blocker is "open" when `!isClosed(status)`
- reference: `PRODUCT.md`, `DESIGN.md`, screenshots in `C:\Users\david\Downloads\Noel`

## 2. What Section 5 built (Task detail B: custom fields, attachments, comments + activity)
Extended the task-detail surface (modal panel + `/board/task/[id]` route) with custom fields,
attachments (graceful-degraded), and a comments + append-only activity feed. All reads scoped,
all mutations re-authorized via `findVisibleTask`. **117 unit tests pass** (was 79; +38).

- **Custom fields — all 9 v1 types.** `src/domain/customFields.ts` (+ tests) holds the pure
  `parseFieldValue(type, config, raw)` / format / validate logic for TEXT, NUMBER, CHECKBOX,
  DATE, DROPDOWN, LABELS (multi-select), RATING (stars), PEOPLE, SLIDER (manual progress 0–100).
  `setCustomFieldValueAction` re-auths the task via `findVisibleTask` **then verifies the field
  belongs to `task.boardId`** (IDOR-safe) and upserts on the `@@unique([taskId,fieldId])`. PEOPLE
  also syncs the `people User[]` relation (ids kept in `value` too). A "+ Add field" affordance
  defines a field on the board. **Seed** now defines an example field of every type on the
  Innovations board so the editors are demoable.
- **Attachments — wired, degrades without a key.** `src/lib/storage.ts` wraps Supabase Storage
  via `@supabase/supabase-js` (server-only, service key). Reads `SUPABASE_URL` (defaults to the
  project ref URL) + `SUPABASE_SERVICE_ROLE_KEY`. **The key is NOT set**, so the panel shows
  "Attachments need SUPABASE_SERVICE_ROLE_KEY in .env" and upload is disabled — never crashes. With
  the key present it ensures the bucket, uploads, persists a scoped `Attachment` row, lists +
  signed-URL downloads + deletes (each gated by `findVisibleTask` + row-ownership).
- **Comments + activity.** `CommentEditor.tsx` (Tiptap) posts a `Comment` (`body` Json); create/
  edit/delete gated by `findVisibleTask` + author ownership (a member can't touch a comment on a
  task they can't see). `src/lib/activity.ts` writes **append-only** `ActivityLog` entries;
  `src/domain/activity.ts` (+ tests) formats them. Entries are emitted from BOTH the §4 mutations
  (status/assignee/priority/date/etc.) and the §5 mutations (custom-field set, comment created,
  attachment added). The panel renders a combined comments + activity feed, newest-first.

## 3. Files added/changed
- `src/domain/customFields.ts` + `customFields.test.ts` — pure per-type parse/format/validate (NEW, TDD).
- `src/domain/activity.ts` + `activity.test.ts` — activity entry formatting (NEW, TDD).
- `src/lib/storage.ts` — Supabase Storage wrapper, graceful-degraded (NEW).
- `src/lib/activity.ts` — append-only `ActivityLog` writer + emit helpers (NEW).
- `src/app/board/task/CommentEditor.tsx` — Tiptap comment composer (NEW).
- `src/app/board/task/TaskPanelExtras.tsx` — custom fields + attachments + comments/activity UI (NEW).
- `src/app/board/task/data.ts` — scoped loader extended (custom fields+values, attachments, comments, activity) (CHANGED).
- `src/app/board/task/actions.ts` — `setCustomFieldValueAction`, attachment + comment actions, activity emits added to existing mutations (CHANGED).
- `src/app/board/task/{TaskPanel,TaskPanelClient,TaskDetailView}.tsx` + `panel.module.css` — render the new sections (CHANGED).
- `prisma/seed.ts` — example custom field of each type on the Innovations board (CHANGED).
- `.env.example` — `SUPABASE_URL=` + `SUPABASE_SERVICE_ROLE_KEY=` placeholders (CHANGED).
- `package.json` / `-lock.json` — `@supabase/supabase-js` (CHANGED).
- `docs/handoffs/06-dependencies.md` — this file (NEW).

## 4. State of the world
- **Migrations:** unchanged — `20260629020818_init_data_model` only. All §5 models already
  existed; **no new migration**. `npx prisma migrate status` → up to date. `npx prisma validate` ok.
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY` (all in `.env`).
  **Optional:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to enable attachments (currently
  unset → attachments show a disabled "needs key" state; everything else works).
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in at `/login` (`noel@halevora.com` / `halevora`, CEO).
- **Verified (orchestrator, this session):** `npm run typecheck` clean · `npm test` **117/117** ·
  `npm run build` clean · `npx prisma validate` + `migrate status` in sync · seed idempotent.
  **Browser smoke (chrome-devtools, CEO):** opened the Innovations "Prototype" task — all 9
  custom-field editors render (text/number/checkbox/date/dropdown=Build/labels/rating=4-5/people=T2/
  slider=70%); attachments show the graceful "needs SUPABASE_SERVICE_ROLE_KEY" banner; the
  append-only activity feed shows "updated Reviewers/Progress/Stage/Confidence"; comment composer
  renders. No console errors; desktop + 390px mobile both clean (screenshots in session scratchpad).
- **Security:** every new task read composes the scope; every mutation re-auths via
  `findVisibleTask` (27 gates) + row-ownership (custom-field→board, comment→task+author,
  attachment→task). Audited by the orchestrator: no leak surface.

## 5. Open issues / deferred
- **Attachments await `SUPABASE_SERVICE_ROLE_KEY`** (+ optional `SUPABASE_URL`) in `.env` — code is
  complete and runtime-gated; drop the key in to enable, no code change needed.
- **Dev DB has demo artifacts** from feature exercises on the "Prototype" task (a `qa-smoke` tag,
  a subtask, a checklist, custom-field values, activity rows). Harmless; the seed is idempotent
  and leaves them. Re-point at a clean DB if you want pristine seed state.
- **Recovered section:** the §5 build agent crashed before committing/handoff; the orchestrator
  verified the working tree (gate + browser smoke) and finished the commit + this handoff.
- Tiptap `onUpdate` doesn't fire for programmatically-injected text (the Comment button stays
  disabled under CDP automation) — a real keystroke enables it; not a product bug.
- `requireActor`/`requireRole` still throw plain `Error`; server actions surface a returned
  `{error}` string. Map to 401/403 if a route handler ever calls them directly.

## 6. NEXT SECTION (Section 6): Task dependencies
**Goal:** blocking / waiting-on links between tasks, with cycle prevention and a **Done-gate**.

**The model (already in the schema):** `TaskDependency` is a **single directed edge**
`blocker → blocked` — the blocker must be **closed** (`isClosed(status)`) before the blocked task
may be marked **DONE**. "X is waiting on Y" == edge(blocker=Y, blocked=X) (incoming edges of X);
"X is blocking Z" == edge(blocker=X, blocked=Z) (outgoing edges of X). There is no separate type
enum — the two UI directions are just the in/out views of the same edge. `@@unique([blockerId,
blockedId])`; relations `Task.blocking` (as blocker) and `Task.blockedBy` (as blocked).

**First 3 steps:**
1. **Pure cycle prevention** in `src/domain/` (e.g. `dependencies.ts`) with TDD: given the existing
   edge set + a proposed `blocker → blocked`, detect whether adding it creates a cycle (DFS/visited
   over the directed graph; also reject self-edges and duplicates). This is the load-bearing
   correctness piece — test it hard (simple cycle, transitive cycle, diamond no-cycle, self-edge).
2. **Mutations** in `task/actions.ts` (gated by `findVisibleTask` for BOTH endpoints — a member
   must be able to see both tasks to link them; re-auth each id): `addDependencyAction`
   (blocking or waiting-on; runs the cycle check before insert) and `removeDependencyAction`.
   Emit append-only activity (`dependency_added` / `dependency_removed`) via `src/lib/activity.ts`.
3. **Enforce the Done-gate server-side** in the status-change action(s) — on the board
   (`src/app/board/actions.ts`) AND in the detail panel (`task/actions.ts`): refuse to set a task
   to DONE while it has any **open** blocker (a `TaskDependency` whose `blocker` is not closed).
   Return a clear `{error}` ("Blocked by N open task(s)"). Then build the detail-panel UI to
   add/remove blocking + waiting-on links (pick tasks via a scoped search) and show the lists, and
   a small **"blocked" indicator** on the board card (`Board.tsx`) when a task has an open blocker.

**Gotchas:**
- **Scope both endpoints** of every link; **re-authorize** each task id. Never trust client ids.
- The cycle check must run **server-side before insert** (a client could post any pair).
- The Done-gate is **server-enforced**, not just a disabled button — enforce it in EVERY path that
  can set DONE (board status dropdown + detail status control). Reviewed also implies passing
  through Done in spirit; gate DONE specifically (and decide whether REVIEWED is likewise gated —
  recommend yes, since Reviewed is "more done than Done").
- A blocked task can still be edited; only the **DONE transition** is gated.
- `ActivityLog` is append-only. Run `halevora-permissions-audit` + `halevora-qa-gate` before the
  Section 7 handoff. Browser-smoke with a CEO and a MEMBER (incl. that a member can't link to a
  task they can't see, and that the Done-gate blocks via the API, not just the UI).
