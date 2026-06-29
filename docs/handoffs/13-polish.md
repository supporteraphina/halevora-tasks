# Handoff 13 — Polish (Section 13 entry, the FINAL section)   (Section 12 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (spec — esp. §4 row-level visibility, §5 v1 scope, §6 the
  section map: §13 is the FINAL section and depends on ALL prior work)
- this file
- `DESIGN.md` + `src/styles/tokens.css` (the dark OKLCH token system — all color via variables)
- the design skills (installed globally): **`impeccable`** (audit/polish), **`include`** (a11y),
  **`transpose`** (mobile), **`fortify`** (edge/empty/error/loading), **`stop-slop`** (copy)
- the project skills: `halevora-qa-gate` (run before handoff), `halevora-permissions-audit`
  (re-run if any data path changes), `halevora-realtime-debug`
- files §13 will most likely touch: every `*.module.css`, `src/components/AppShell.*`,
  `src/components/HeaderTools.*`, the board/task/views/chat/inbox/search surfaces, and any
  empty/loading/error states across them

## 2. What Section 12 built (Notifications + @mentions + global search)
A notifications inbox, @mentions in comments + chat, and a scoped global search — all three
reuse the §11 SSE stream for live delivery. **350 unit tests pass** (was 311; +39: realtime
notification codec/recipient rule, mention extraction, notify-dedupe, search match/rank).

- **Notification model + migration.** New `Notification` model (`id, recipientId, type
  (assigned|mentioned|commented), taskId?, boardId?, commentId?, actorId?, data Json?, readAt?,
  createdAt`) + a `NotificationType` enum. Migration **`20260629115650_notifications`**, applied,
  `migrate status` in sync. Index `(recipientId, readAt, createdAt)` serves the inbox query.
- **Per-event notifications (pure rules + emit helper).** `src/domain/notifications.ts` (TDD) owns
  WHO gets notified: assigned-to-you (the new assignee), @mention (comment + chat), and
  comment-on-a-task-you're-assigned-to/created — with per-recipient de-dupe and a never-notify-
  yourself rule (a user who is both mentioned AND a stakeholder gets ONE `mentioned` ping).
  `src/lib/notifications.ts` writes the rows then live-pings each recipient. Wired into
  `createCommentAction` + `toggleAssigneeAction` (`src/app/board/task/actions.ts`) and
  `sendChatMessageAction` (`src/app/chat/actions.ts`). All best-effort — never blocks the mutation.
- **@mentions (pure parse + chips + autocomplete).** `src/domain/mentions.ts` (TDD) resolves
  `@handle` tokens (collapsed name OR email local-part, case-insensitive, longest-handle-wins)
  against the real user set, from BOTH a plain chat string and a Tiptap comment doc (defensive
  walk, never throws; also reads a structured `mention` node's `attrs.id` if present). Chat has a
  live `@`-autocomplete dropdown + renders mentions as chips (`src/components/MentionText.tsx`).
- **Inbox UI (live).** A header **bell** with an unread badge + a dropdown panel
  (`src/components/HeaderTools.tsx` + `.module.css`): lists notifications, mark-one / mark-all
  read, click-through to the task. Updates LIVE over SSE — the bell increments without a reload.
  Seeded with the initial unread count from the layout (`src/app/layout.tsx`).
- **Global search (scoped command palette).** A header **search** button + Ctrl/Cmd-K overlay
  (in `HeaderTools.tsx`) calling `searchAction` (`src/app/search/actions.ts`), which composes
  `taskScopeWhere(actor)` so a MEMBER only finds tasks assigned to them; the CEO finds all. Pure
  match/rank in `src/domain/search.ts` (TDD): exact > title-prefix > title-contains > description.

**SECURITY — how §12 holds the invariant (audited, AUDIT PASS — 0 leaks):**
- **Search is scoped** exactly like every other read: `src/app/search/actions.ts:50-51`
  `where: { AND: [ taskScopeWhere(actor), {...} ] }`. Browser-proven: member1 searching the
  CEO-only "Draft Q3 success playbook" got **0 results**; the CEO found it.
- **Notifications are per-recipient.** Every read filters `recipientId = actor.userId`
  (`src/lib/notificationsData.ts:61,81`; `src/app/inbox/actions.ts:33,44` — a foreign id is a
  silent no-op, IDOR-safe). The live channel is `user_<recipientId>`; the SSE relay authorizes a
  `notification` event ONLY when `event.recipientId === actor.userId`
  (`src/domain/realtime.ts:canReceiveEvent`, checked BEFORE the CEO shortcut, so a CEO never
  receives another user's notification) via `actorMayReceive` (`src/lib/realtimeScope.ts`).
- **@mention does NOT widen visibility (documented rule).** Being mentioned grants a
  notification, never task/board access. The notification links to the surface, but opening it
  routes through the scoped `loadTaskDetail` and 404s if the recipient isn't otherwise a viewer.
  The inbox snippet (`data.taskTitle`/`boardName`) is captured at emit time from a surface the
  actor could already see, and the live ping carries ids only — no task content on the wire.

## 3. Files added/changed
**Added (domain, pure + TDD):**
- `src/domain/mentions.ts` + `mentions.test.ts` — @handle grammar + resolution (name/email).
- `src/domain/notifications.ts` + `notifications.test.ts` — notification type + recipient rules.
- `src/domain/search.ts` + `search.test.ts` — query normalize + match/rank + doc flatten.

**Added (server + UI):**
- `src/lib/notifications.ts` — emit helper (write rows + live ping; @mention-no-leak doc).
- `src/lib/notificationsData.ts` — recipient-scoped read (list + unread count).
- `src/app/inbox/actions.ts` — fetch / mark-read / mark-all-read (recipient-scoped).
- `src/app/search/actions.ts` — scoped global search action.
- `src/components/HeaderTools.tsx` + `HeaderTools.module.css` — bell + inbox panel + search overlay.
- `src/components/MentionText.tsx` + `MentionText.module.css` — mention chip renderer.

**Changed:**
- `prisma/schema.prisma` — `Notification` model + `NotificationType` enum + User/Task relations.
- `src/domain/realtime.ts` + `realtime.test.ts` — `notification` event type, `userChannel`,
  `user_` channel validation, recipient rule in `canReceiveEvent` (+6 tests).
- `src/lib/realtime.ts` — `notifyChannel` (generic), `publishNotification` (user channel).
- `src/lib/realtimeListener.ts` — generic `subscribeChannel` + `subscribeUser`.
- `src/lib/realtimeScope.ts` — `actorMayReceive` handles `notification` (recipient check).
- `src/app/api/stream/route.ts` — subscribes the actor to their own `user_<id>` channel always.
- `src/components/useRealtime.ts` — `alwaysConnect` param (stream opens with no boards, for the bell).
- `src/components/AppShell.tsx` + `AppShell.module.css` — `.right` cluster hosting HeaderTools.
- `src/app/layout.tsx` — passes `userId` + initial `unread` to AppShell.
- `src/app/board/task/actions.ts` — notify on comment + on assignee-add.
- `src/app/chat/actions.ts` — notify on chat @mention.
- `src/app/chat/page.tsx` + `ChatClient.tsx` + `chat.module.css` — mention candidates, chips,
  `@`-autocomplete dropdown.

## 4. State of the world (verified)
- **Migrations:** 5 total; new = `20260629115650_notifications`. `prisma validate` ok,
  `migrate status` "up to date". (Other models unchanged.)
- **Env needed:** unchanged from §11 — `DATABASE_URL` (pooled + NOTIFY), **`DIRECT_URL`** (session,
  the LISTEN worker), `AUTH_SECRET`, `ANTHROPIC_API_KEY`. Optional `SUPABASE_*` for attachments.
- **No new deps.** (`pg` was added in §11.)
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in `noel@halevora.com` / `halevora` (CEO) or `member1@halevora.com` / `halevora` (MEMBER).
- **Verified this session:** `npm run typecheck` clean · `npm test` **350/350** · `npm run build`
  clean · `prisma validate` + `migrate status` in sync. Manual permissions audit (§12 surfaces):
  **AUDIT PASS — 0 leaks**.
- **Browser smoke (chrome-devtools, TWO isolated contexts — CEO + member1):**
  - **Assign → live notification + live board.** CEO assigned member1 to "Research competitor
    pricing" → member1's bell went 0→1 unread **live, no reload**; the inbox read
    `Noel Pollak assigned you to "Research competitor pricing"`; the task appeared on member1's
    Innovations board live (count 2→3). Clicking the notification opened the task (visible now,
    since member1 is an assignee) and marked it read (badge cleared).
  - **Chat @mention → live notification + chip.** CEO posted "Hey @member1 …" on Innovations →
    rendered as a chip on the CEO side; member1's bell went 0→1 unread **live, no reload**; inbox
    read `Noel Pollak mentioned you in Innovations chat`. Mark-all-read cleared the badge.
  - **Scoped search.** member1 searching "Draft Q3" (a CEO-only task) → **0 results**; member1
    searching "Refresh creative" (their own) → 1 result. CEO searching "Draft Q3" → finds it.
  - **No console errors** in either context; only a benign `pg` deprecation warning in the dev log
    (the §11 listener re-issuing LISTEN — pre-existing, not §12). Test artifacts cleaned up.

## 5. Open issues / deferred (with TODO markers where relevant)
- **Comment mention chips are plain text, not styled chips.** The chat surface renders `@handle`
  as a chip + has a live autocomplete; comments (rich Tiptap docs) store/notify mentions correctly
  but render the `@handle` as plain text inside the StarterKit render. A real Tiptap mention
  extension (suggestion + node view) is a §13 polish item. Notifications already work for comments.
- **Tiptap v3 programmatic-typing quirk (test only).** The comment composer's submit button stays
  disabled when text is injected programmatically (Tiptap v3 doesn't re-render on synthetic
  keystrokes from the test harness). Real human typing works; this only affected automated comment
  entry in the smoke test, so the comment-mention path was verified via unit tests + the wired emit.
- **Notification list is a recent window (30), not paged.** No "load more"; older notifications stay
  in the DB. A scrollback pass is §13 polish (same shape as chat's unpaged window).
- **Search description match is in-memory over a 200-row window** (`searchAction` over-fetches
  recent scoped tasks and ranks). Correct + scoped at team scale; a Postgres FTS/`tsvector` index
  is the scale-up path if the task count grows large. Title match is a real SQL `contains`.
- **No notification preferences / digest.** Every qualifying event notifies; there's no per-user
  mute/grouping. Out of v1 scope; note for a future settings pass.
- Carried from §11: presence has no snapshot-on-connect; board live-refresh is coarse
  (`router.refresh()`); single-process in-memory presence.

## 6. NEXT SECTION (Section 13): Polish — the FINAL section (depends on ALL prior work)
**Goal:** take the now-complete app from "works + correct + scoped" to "impeccable". This is a
quality pass across every surface, not new features. Hold the security invariant — if any change
touches a data path, re-run `halevora-permissions-audit` before the final handoff.

**Entry point:** run the design skills as an audit-then-fix loop over the live app (start
`npm run dev`, drive with chrome-devtools, two accounts). Work surface by surface
(board → task detail → views/calendar → chat → inbox/search → admin/login), each through the five
lenses below. Keep diffs surgical; all color via `src/styles/tokens.css`.

**First 3 steps:**
1. **`impeccable` audit pass.** Visual hierarchy, spacing rhythm, alignment, typography, motion,
   micro-interactions across the screenshots' look. Run `/impeccable audit` (scripts live at
   `~/.claude/skills/impeccable/scripts/...` — global install). Tighten the §12 additions too
   (the bell/badge, inbox panel, search overlay, mention chips) against the token system.
2. **`include` a11y pass.** Keyboard nav for the DnD gaps flagged across §3/§4/§9/§10/§13 (board
   card move, calendar drag-to-date — both native HTML5 DnD with NO keyboard reschedule yet; add a
   "Move to…" / "Reschedule…" menu or dnd-kit), focus management (modals, the search overlay,
   inbox panel — verify focus trap + restore), visible focus rings, color contrast against the
   dark tokens, ARIA roles/labels (the search overlay listbox, inbox dialog, status dropdowns).
3. **`transpose` mobile pass.** The 390px layouts: the board grid, the task detail panel (currently
   a wide aside), the chat two-pane, the header tab row + the new HeaderTools cluster (the inbox
   panel already has a 520px fixed-position fallback — verify it), the search overlay.

**Then:**
4. **`fortify` edge/empty/error/loading states.** Inventory every surface's zero/empty/error/
   loading state. Known gaps: empty-board "create a board" affordance (§3); empty inbox already has
   a caught-up state (verify copy); search empty/too-short states exist (polish copy); loading
   skeletons for the board + task detail; error toasts for failed server actions (many actions
   return `{ error }` but some UIs swallow it).
5. **`stop-slop` copy pass.** All UI text: labels, buttons, empty states, placeholders, the
   notification phrasings (`describe()` in HeaderTools), error messages. Active voice, no em dashes,
   no AI tells.

**Specific deferred polish items collected across §3–§12 (address or consciously defer each):**
- **Keyboard reorder/reschedule** — board card move (§3) + calendar drag-to-date (§9/§10) are
  native HTML5 DnD with no keyboard path. The flagship a11y gap.
- **Empty-board "create a board" affordance** (§3) — grid renders existing boards only.
- **Comment @mention chips + Tiptap mention extension** (§12) — comments render mentions as plain
  text; chat already chips them.
- **Notification + chat pagination** (§11/§12) — both load a recent window, no scrollback.
- **Board live-refresh is coarse** (`router.refresh()` on a task event, §11) — could patch one card.
- **Presence snapshot-on-connect** (§11) — a late joiner doesn't learn who's already present.
- **AI-assisted description** polish (§4) — the editor's Claude prompt UX.
- **Loading/skeleton states** for board + task detail (none yet).
- **Templates "add to board" surface** (§10) — optional board affordance not wired.

**Gotchas:**
- **Do not regress scope.** Any data-path edit re-runs `halevora-permissions-audit`. The five
  invariants that must still hold: search scoped, notifications per-recipient, realtime leak gate,
  @mention-no-leak, mutations re-authorized server-side (never trust a client id).
- **All color via tokens.** No hardcoded hex; `src/styles/tokens.css` is the single source. Light
  theme is a future swap — keep the variable indirection.
- **Run `halevora-qa-gate`** (typecheck + test + build + prisma) before the §13 handoff. This is the
  LAST section — leave the tree green and the app demo-ready.
