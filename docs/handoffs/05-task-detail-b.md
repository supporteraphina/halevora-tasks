# Handoff 05 — Task detail B (Section 5 entry)   (Section 4 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (project spec, scope, partition; esp. §4 two load-bearing
  decisions and §5 v1 scope)
- this file
- files Section 5 edits/reads:
  - `src/app/board/task/data.ts` — the SCOPED single-task loader Section 5 extends with
    custom-field values, attachments, comments, and the activity log.
  - `src/app/board/task/actions.ts` — the server-action idioms + the `findVisibleTask`
    re-auth gate every new mutation must compose.
  - `src/app/board/task/TaskPanel.tsx` — the client panel; add custom-fields, attachments,
    comments + activity sections here (same `useAction()` / `usePopover()` helpers).
  - `src/lib/scope.ts` (`taskWhereForCurrentUser`, `currentActor`, `requireActor`) +
    `src/domain/scope.ts` (`taskScopeWhere`, `canSeeTask`) — compose into EVERY new read/mutation.
  - `prisma/schema.prisma` — `CustomField` / `CustomFieldValue` (with the `CustomFieldType`
    enum: TEXT/NUMBER/CHECKBOX/DATE/DROPDOWN/LABELS/RATING/PEOPLE/SLIDER), `Attachment`,
    `Comment` (Tiptap `body Json`), `ActivityLog` (append-only) models all already exist.
  - `src/styles/tokens.css` (dark OKLCH tokens; status + priority vars defined).
- reference: `PRODUCT.md`, `DESIGN.md`, and Noel's ClickUp screenshots in
  `C:\Users\david\Downloads\Noel`.

## 2. What Section 4 built (Task detail A)
Clicking a card on `/board` opens a **Task detail** surface that keeps board context. Every
read is row-level scoped to the current actor; every mutation re-authorizes server-side against
the client-supplied task id (a card id is untrusted). Overdue stays derived, never stored.

- **Detail surface = panel over the board (preferred) AND a deep-link route.** A `@modal`
  parallel slot with an intercepting route `@modal/(.)task/[id]` renders the panel over `/board`
  for in-app clicks; a hard load / refresh of `/board/task/[id]` falls through to the full-page
  route. Both render the same `TaskDetailView` server component (`@modal/default.tsx` renders
  nothing when no task is open).
- **Scoped single-task loader** (`task/data.ts`): `loadTaskDetail(id)` reads the task under
  `{ AND: [ taskWhereForCurrentUser(), { id, archivedAt: null } ] }`, selecting assignees, tags,
  checklists + items, and `description`. Subtasks are loaded with a SEPARATE scoped query
  (`{ AND: [ taskScopeWhere(actor), { parentId, archivedAt: null } ] }`) so a member sees a
  subtask only when assigned to it. Returns null for an invisible/foreign id →
  `TaskDetailView` calls `notFound()` (no existence leak). `loadPickerData()` returns all users
  + all tags for the pickers (names are not task content; any member may assign to anyone).
- **Field editors** (all in `task/actions.ts`, all `"use server"`, all gated by
  `findVisibleTask` which re-queries under `taskScopeWhere(actor)`):
  status (grouped dropdown, writes only the 4 stored statuses) · priority (URGENT/HIGH/NORMAL/
  LOW) · assignees (add/remove any `User`; a MEMBER removing themselves loses visibility — the
  UI `window.confirm`s first) · start + due dates (ClickUp picker) · time estimate (minutes) ·
  tags (connect/disconnect + create-new via `tag.upsert` on the unique name) · Tiptap
  description (persisted to `Task.description Json`) · subtasks (create with `parentId` +
  inherited `boardId`, auto-assign creator, toggle TODO/DONE — re-auth is against the SUBTASK's
  own scope) · checklists + items (add list / add item / check / delete; every checklist/item
  mutation also verifies the row belongs to the visible task, blocking IDOR via a guessed
  checklist/item id) · rename title.
- **Date math is pure + TDD** (`src/domain/dates.ts`, `dates.test.ts`): six quick choices
  **Today / Tomorrow / This weekend / Next week / 2 weeks / 4 weeks**. Dates are **UTC-stored,
  rendered in the actor's `timezone`**. A quick choice resolves to the UTC instant marking local
  midnight of the chosen day in the actor's tz (via `Intl.DateTimeFormat` zone parts + a one-step
  offset correction — no date library). `formatInZone` / `dateInputValue` / `parseDateInput`
  render/parse in-zone. "This weekend" = the coming Saturday; "Next week" = the coming Monday
  (a Monday jumps +7). Validation helpers (`parseTimeEstimate`, `normalizeTagName`,
  `formatTimeEstimate`) are pure + tested in `taskDetail.ts` / `taskDetail.test.ts`.
- **AI-assist** (`task/ai.ts`, server-only): `aiAssistDescription(taskId, instruction)` re-auths
  the task under scope, then drafts a description with the official Anthropic SDK
  (`@anthropic-ai/sdk`). **Model id `claude-opus-4-8`** with `thinking: { type: "adaptive" }` —
  both taken from the `claude-api` skill (NOT memory). Reads `ANTHROPIC_API_KEY` from env.
  Degrades gracefully: `aiAssistAvailable()` gates the button; a missing key returns
  `{ enabled: false, error: "Set ANTHROPIC_API_KEY to enable…" }` and never crashes. The key
  is real and set in `.env`, so the live call works (verified — see §4).

## 3. Files added/changed
- `src/app/board/Board.tsx` — `Card` now opens the detail (click + Enter/Space →
  `/board/task/[id]`); a click on the status badge / its menu is skipped (CHANGED).
- `src/app/board/layout.tsx` — board layout with the `@modal` parallel slot (NEW).
- `src/app/board/@modal/default.tsx` — renders nothing when no task is open (NEW).
- `src/app/board/@modal/(.)task/[id]/page.tsx` — intercepting modal route → `TaskDetailView` (NEW).
- `src/app/board/task/[id]/page.tsx` — full-page deep-link route → `TaskDetailView` (NEW).
- `src/app/board/task/TaskDetailView.tsx` — shared server component: scoped load + 404 gate +
  picker + ai-availability, renders the client panel (NEW).
- `src/app/board/task/TaskPanelClient.tsx` — client wrapper giving the panel an `onClose` →
  `/board` (NEW).
- `src/app/board/task/TaskPanel.tsx` — the client panel: all field editors, subtasks, checklists,
  description section + AI button (NEW).
- `src/app/board/task/DescriptionEditor.tsx` — Tiptap editor (StarterKit), saves on blur, accepts
  AI-inserted text (NEW).
- `src/app/board/task/data.ts` — scoped single-task loader + picker loader (NEW).
- `src/app/board/task/actions.ts` — all detail mutations + the `findVisibleTask` re-auth gate (NEW).
- `src/app/board/task/ai.ts` — server-only Claude AI-assist + availability check (NEW).
- `src/app/board/task/panel.module.css` — panel/overlay/field/picker/editor styles, dark,
  tokens-only (NEW). (Section-4-session edit this pass: gave the title textarea a one-line
  `min-height` so a single-line title is never clipped.)
- `src/domain/dates.ts` + `dates.test.ts` — pure tz/quick-choice date math, TDD (NEW).
- `src/domain/taskDetail.ts` + `taskDetail.test.ts` — pure validation/format helpers, TDD (NEW).
- `src/styles/tokens.css` — added the few panel-specific token aliases the panel uses (CHANGED).
- `package.json` / `package-lock.json` — added `@anthropic-ai/sdk` (CHANGED).
- `.env.example` — added the `ANTHROPIC_API_KEY=` placeholder + a comment (CHANGED).

## 4. State of the world
- **Migrations:** unchanged — `20260629020818_init_data_model` only. Section 4 added NO column and
  NO migration (every field it uses — `description`, `startAt`, `dueAt`, `timeEstimate`,
  `Checklist`/`ChecklistItem`, `Tag`/`TaskTags`, `parentId` — already existed). `npx prisma
  validate` ok; `npx prisma migrate status` → "Database schema is up to date".
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, and now **`ANTHROPIC_API_KEY`**
  (all in gitignored `.env`; AI-assist degrades gracefully if the key is absent).
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`,
  then `/login`. Seeded logins (password `halevora`): `noel@halevora.com` (CEO),
  `member1@halevora.com`..`member3@halevora.com` (MEMBER).
- **Verified (ran/clicked this session):**
  - `npm run typecheck` clean · `npm test` **79/79** (was 47; +32 in dates + taskDetail) ·
    `npm run build` clean (11 routes incl. `/board/(.)task/[id]` modal + `/board/task/[id]`
    full page) · `npx prisma validate` ok · `migrate status` up to date.
  - **Browser smoke (chrome-devtools MCP), as Noel (CEO):** clicked a card → detail panel opens
    over the board (and a hard reload renders the full-page route). Changed status DONE→IN_PROGRESS
    (panel then shows the DERIVED **Overdue** badge because the due date is past — stored status
    is IN_PROGRESS; persisted across reload). Changed priority Urgent→High (persisted). Set the
    start date via the **"Next week" quick choice** → Jul 6, 2026 (coming Monday; persisted).
    Edited + saved the Tiptap description. **Clicked AI assist → it returned ~2 paragraphs of
    generated text live** (model `claude-opus-4-8`), inserted into the editor and saved (3
    paragraphs persisted across reload). Added a subtask ("Subtasks 1/2") and a checklist item —
    both persisted across reload. No console errors. Desktop + 390px mobile screenshots captured
    (panel fills the mobile viewport, fields stack). Test edits reverted afterward (seed task
    restored to DONE/Urgent/Jun-27/1-paragraph/1-subtask).
  - **Member cannot-open (as member1):** directly navigating to `/board/task/<id>` for a task
    assigned only to Noel returns **404: This page could not be found.** — the scoped loader
    returned null and `TaskDetailView` called `notFound()`. IDOR-safe by construction; no
    existence leak. member1's board also correctly shows only assigned cards (Client Success 0).
  - **Permissions audit (`halevora-permissions-audit`):** all task reads live in 5 files only
    (3 new in `task/`, 2 from §3 in `board/`). VERDICT **AUDIT PASS** — every content-bearing
    task read composes the scope (`loadTaskDetail`, the scoped subtasks query, `ai.ts`,
    `findVisibleTask`); every mutation re-auths via `findVisibleTask` (subtask toggle re-auths
    against the SUBTASK's own scope); checklist/item mutations also verify row ownership against
    the visible task. Unscoped reads (`user`/`tag` pickers, `_max:order` aggregates, the
    `parentId`-only revalidation read) return no task content and never reach the client.
  - **No secrets committed:** `.env` is git-ignored and untracked; a `git grep` for the real
    108-char `ANTHROPIC_API_KEY` value matches NO tracked file and NO source file. `.env.example`
    holds only the empty `ANTHROPIC_API_KEY=` placeholder.

## 5. Open issues / deferred (with code TODO markers)
- **Card-click vs badge-click:** the card open handler skips clicks that land on
  `button,a,[role='listbox']` so the status badge keeps its own menu. A click on the badge does
  NOT open the panel (intended). Keyboard Enter/Space on the focused card opens it.
- **Title textarea top padding:** the title now renders fully (the one-line clip is fixed), but
  its glyph tops still sit a touch close to the panel's top edge at the default scroll position.
  Pure cosmetic; a `scroll-padding` / header-spacing nudge can land in Polish (§13).
- **Drag-and-drop is native HTML5** (no keyboard reorder) — unchanged from §3; Polish (§13).
- **No optimistic UI** — every detail mutation runs the server action then `router.refresh()`.
  Fine for v1 latency; a future pass could make toggles optimistic.
- **`requireActor`/`requireRole` still throw plain `Error`** — server actions surface a returned
  `{error}` string; if §5 adds a route handler, map those throws to 401/403.
- **Checklists have no rename / reorder** — add-list / add-item / check / delete only. The
  schema supports `name` + `order`; add if the product needs it.
- **AI-assist ignores the current description** — it drafts from the task title only and appends.
  An "expand/rewrite the existing description" mode is a natural follow-up (the action already
  accepts an `instruction` arg; the UI only sends "").

## 6. NEXT SECTION (Section 5): Task detail B
**Goal:** finish the task-detail surface with **custom fields**, **attachments**, and
**comments + an activity log**.

- **Custom fields** — `CustomField` is defined per Board; `CustomFieldValue` is per (task,field)
  with a `@@unique([taskId, fieldId])`. Build the v1 field types only (per §5 scope / handoff 00
  §5 backlog note): **text, number, checkbox, date, dropdown, labels, rating (star), people,
  slider (manual progress 0-100)**. `CustomField.config Json` holds type-specifics (dropdown
  options, rating max, slider min/max); `CustomFieldValue.value Json` holds the value (PEOPLE
  also has a `people User[]` relation — keep the ids in `value` too for portability). Load the
  board's fields + this task's values in the SCOPED detail loader; add per-field editors in
  `TaskPanel.tsx`; add authorized mutations in `task/actions.ts` (re-auth via `findVisibleTask`,
  then upsert the `CustomFieldValue`).
- **Attachments** — `Attachment` model exists (`path` = Supabase Storage object key, `url` =
  cached signed/public URL). Needs a **Supabase Storage bucket + storage keys** (the project ref
  is `ggpubtmydqiywxlfpckx`; add the storage env vars to `.env`/`.env.example`). Upload via a
  server action (or a signed-upload URL), persist the `Attachment` row scoped to the visible
  task, list + download + delete in the panel. Keep the key server-side; never expose service keys
  to the client.
- **Comments + activity log** — `Comment.body` is a Tiptap `Json` doc (reuse `DescriptionEditor`);
  `ActivityLog` is **append-only** (never updated/deleted by app code — emit an entry on each
  mutation: status_changed, assignee_added, comment_created, …). Render a combined comments +
  activity feed in the panel, newest-first. Author is the current actor.

**Entry point:** extend `task/data.ts` (scoped load: add custom-field values, attachments,
comments, recent activity), add the editors to `TaskPanel.tsx`, and add the mutations to
`task/actions.ts` (each gated by `findVisibleTask`). Run `halevora-permissions-audit` after — a
comment, attachment, or custom-field value must never surface a hidden task, and a MEMBER must
not comment on / attach to / read activity for a task they can't see.

**First 3 steps:**
1. Create the Supabase Storage bucket + add storage env vars (`.env` + `.env.example` placeholder);
   wire a minimal scoped upload server action and confirm a round-trip (upload → `Attachment`
   row → list → download) for a visible task.
2. Add custom-field load + per-type editors + `setCustomFieldValueAction` (upsert on the unique
   `[taskId, fieldId]`), gated by `findVisibleTask`. Put any pure value parsing/formatting in
   `src/domain/` with TDD (mirrors `taskDetail.ts`).
3. Add comments (Tiptap) + the append-only `ActivityLog` feed; emit activity entries from the
   existing §4 mutations too (status/assignee/priority/date changes) so the feed is populated.

**Gotchas:**
- **Scope every new read; re-authorize every mutation** via `findVisibleTask` — including the
  attachment/comment/custom-field paths. A checklist-style row-ownership check applies: an
  attachment/comment id from the client must be verified to belong to the visible task.
- **`ActivityLog` is append-only** — never update or delete entries in app code.
- **Supabase service/storage keys are secrets** — `.env` only, never committed, never shipped to
  the client. Add only the `KEY=` placeholder to `.env.example`.
- **Storage object keys, not raw files, live in the DB** — `Attachment.path` is the bucket object
  key; generate signed URLs server-side for download.
- Run `halevora-qa-gate` before the §6 handoff; browser-smoke the new sections with a CEO and a
  MEMBER account (incl. the member cannot-open / cannot-comment check).
