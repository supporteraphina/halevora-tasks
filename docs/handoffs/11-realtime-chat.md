# Handoff 11 — Realtime + per-board chat (Section 11 entry)   (Section 10 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (spec — esp. §2 the pooled-vs-direct connection split, §4 decisions)
- this file
- files Section 11 edits/reads:
  - `src/lib/prisma.ts`, `.env` (`DIRECT_URL` port 5432 — the LISTEN worker MUST use this)
  - `src/lib/scope.ts`, `src/domain/scope.ts` (`canSeeTask` — scope every realtime event)
  - `src/app/chat/page.tsx` (placeholder route to build), the `ChatMessage` model in `prisma/schema.prisma`
  - `src/app/board/Board.tsx`, `src/app/board/data.ts`/`actions.ts` (emit + receive live board events)
  - `src/components/AppShell.tsx` (Chat nav tab)
  - the project skill **`halevora-realtime-debug`** (pooled-vs-direct LISTEN/NOTIFY guidance)
- reference: `PRODUCT.md`, `DESIGN.md`, screenshots in `C:\Users\david\Downloads\Noel`

## 2. What Section 10 built (Templates + bulk edit)
Reusable task templates (save-as + create-from) and multi-select bulk edit across the board and
list views. **293 unit tests pass** (was 267; +26). Recovered from a crashed build agent — the
orchestrator verified the working tree (typecheck/test/build/prisma + chrome-devtools smoke) and
finished the commit + this handoff.

- **Templates.** `TaskTemplate.data` (Json) holds a task blueprint. `src/domain/templates.ts`
  (+ tests) does pure blueprint (de)serialization/validation (never throws). Save-as-template
  captures an existing task's title/description/priority/checklists/custom-field-values/subtasks;
  create-from-template materializes the blueprint onto a chosen target board (authorized create,
  assigned like the normal create path so a member sees their own). UI: `src/app/board/templates/`
  (`page.tsx` + `TemplatesManager.tsx` + `data.ts` + `actions.ts`), reachable via a "Templates"
  breadcrumb link. Verified: a seeded "Onboarding prototype template" lists "1 subtask · 1
  checklist · 4 fields" and applies to any board.
- **Bulk edit.** `src/components/BulkToolbar.tsx` + multi-select checkboxes on board cards
  (`Board.tsx`) and the list view (`views/ListView.tsx`). `src/app/board/bulkActions.ts` server
  actions: set status, set priority, add/remove assignee, add/remove tag, **archive (soft-delete
  `archivedAt`, never hard-delete)**. Pure selection/diff logic in `src/domain/bulk.ts` (+ tests).
  Append-only activity emitted per task.

## 3. Files added/changed
- `src/domain/templates.ts` + `templates.test.ts` — pure blueprint (de)serialize/validate (NEW, TDD).
- `src/domain/bulk.ts` + `bulk.test.ts` — pure bulk selection/diff logic (NEW, TDD).
- `src/app/board/bulkActions.ts` — scoped bulk mutations (NEW).
- `src/app/board/templates/{page,TemplatesManager,data,actions}.{tsx,ts}` + `templates.module.css` — templates UI (NEW).
- `src/components/BulkToolbar.tsx` + `BulkToolbar.module.css` — selection toolbar (NEW).
- `src/app/board/{Board.tsx,board.module.css,page.tsx}` — multi-select + Templates link (CHANGED).
- `src/app/board/task/{TaskPanel.tsx,panel.module.css}` — save-as-template affordance (CHANGED).
- `src/app/views/{ListView.tsx,views.module.css}` — multi-select on lists (CHANGED).
- `src/domain/activity.ts` + `activity.test.ts` — bulk/template activity types (CHANGED).
- `docs/handoffs/11-realtime-chat.md` — this file (NEW).

## 4. State of the world
- **Migrations:** unchanged — 4 migrations; `TaskTemplate` already existed, so **no new migration**.
  `npx prisma validate` ok, `migrate status` up to date.
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY` (in `.env`).
  Optional `SUPABASE_*` for attachments.
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in `noel@halevora.com` / `halevora`.
- **Verified (orchestrator, this session):** `npm run typecheck` clean · `npm test` **293/293** ·
  `npm run build` clean · `npx prisma validate` + `migrate status` in sync. **Browser smoke
  (chrome-devtools, CEO):** multi-selected 2 cards → bulk toolbar (Status/Priority/Assignee/Tag/
  Archive); bulk-set priority → **persisted across reload**; restored to seed. Templates page
  renders the blueprint + apply-to-board. **No console errors.**
- **Security:** bulk mutations enforce scope **in the query** — `updateMany({ where: { AND:
  [taskScopeWhere(actor), { id: { in: ids }, archivedAt: null }] } })` (`bulkActions.ts:52,158,328`),
  so an injected foreign id can't be touched; relation changes (assignee/tag) loop only the
  scoped/visible subset. A MEMBER can only bulk-edit tasks they can see.

## 5. Open issues / deferred
- **Recovered section:** the §10 build agent crashed before committing; the orchestrator verified
  + finished. A demo "Onboarding prototype template" + the §5 demo artifacts remain in the dev DB
  (harmless; seed is idempotent).
- **No realtime push yet** — bulk/template/automation/recurrence changes appear on the next load
  or `router.refresh()`. **Section 11 is exactly this gap.**
- Bulk status change applies the status but (confirm in §11/§13) should also honor the §6 Done-gate
  + fire §7/§8 hooks per task; if the bulk path bypasses per-task event hooks for cost, document it.
- Archive has no in-app "restore" surface yet (soft-deleted rows are recoverable in DB; an
  archive/restore view is a §13 polish candidate).

## 6. NEXT SECTION (Section 11): Realtime + per-board chat   — depends on §2
**Goal:** live updates over **SSE + Postgres `LISTEN`/`NOTIFY`** (no Pusher/Ably): per-board chat,
a live board (task create/move/status/bulk changes appear for other viewers without reload), and
presence.

**The load-bearing infra decision (00 §2):** the `LISTEN` worker **MUST use `DIRECT_URL`
(port 5432)** — Supabase's transaction pooler (6543, `DATABASE_URL`) **cannot** `LISTEN`. Use the
pooled connection for normal queries and a dedicated direct connection for the listener. See the
**`halevora-realtime-debug`** skill before wiring.

**First 3 steps:**
1. **NOTIFY on writes.** After the existing mutations (board create/move/status, bulk, task
   detail, chat send), emit a Postgres `NOTIFY` on a channel (e.g. `board_<id>` / `task_<id>`)
   with a small JSON payload (event type + ids — NOT full task content). Add a thin
   `src/lib/realtime.ts` publish helper (raw `pg`/`prisma.$executeRaw` `pg_notify`).
2. **SSE endpoint + LISTEN.** A route handler (e.g. `src/app/api/stream/route.ts`) that opens an
   SSE stream and a **`DIRECT_URL`** `pg` client `LISTEN`ing on the relevant channels; relay
   payloads to the client. The client subscribes per board/view and re-fetches or patches on
   event. **Scope every event server-side** — never forward an event for a task the subscriber
   can't see (`canSeeTask` / re-query under scope); a member must not learn a task exists via a
   realtime ping.
3. **Per-board chat** (`ChatMessage` model exists): the `/chat` page (and/or a board chat panel) —
   send a message (authorized; `boardId` + author), live-deliver to other board viewers via the
   SSE stream, render newest-last with author + time (per-user tz). Add **presence** (who's
   viewing a board) via a lightweight heartbeat over the same channel. Wire the Chat nav tab.

**Gotchas:**
- **`DIRECT_URL` for LISTEN** — a pooled listener silently never receives notifications. Use a raw
  `pg` `Client` (not Prisma) for the listener; keep one listener per server process, fan out to SSE
  subscribers in memory.
- **Scope realtime events** — this is a fresh leak surface. Run `halevora-permissions-audit` after
  §11; a payload must carry only ids + event type, and the server filters per-subscriber before
  sending. Chat is per board: only board members/the CEO/assignees as appropriate should receive it.
- SSE needs `runtime = "nodejs"` (not edge) and disabled response buffering; handle client
  disconnect (remove the SSE subscriber, close the `pg` listener ref-count).
- Don't block: realtime is additive — if the stream drops, the app still works on reload.
- Run `halevora-qa-gate` + `halevora-realtime-debug` before the §12 handoff; browser-smoke chat +
  a live board change across TWO browser contexts (CEO + member) and confirm the member never
  receives an event for a task they can't see.
