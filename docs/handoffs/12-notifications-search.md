# Handoff 12 — Notifications + @mentions + global search (Section 12 entry)   (Section 11 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (spec — esp. §2 pooled-vs-direct connection split, §4 the
  row-level visibility decision, §5 v1 scope: notifications/inbox, @mentions, global search)
- this file
- files Section 12 edits/reads:
  - `prisma/schema.prisma` (add a `Notification` model — migration needed)
  - `src/lib/realtime.ts` + `src/lib/realtimeListener.ts` + `src/app/api/stream/route.ts`
    (deliver notifications + @mention pings live over the EXISTING §11 SSE stream)
  - `src/domain/realtime.ts` (extend the event union with a `notification` type + codec test)
  - `src/lib/realtimeScope.ts` (per-recipient authorization — notifications are user-targeted)
  - `src/app/board/task/actions.ts` (`createCommentAction`) + `src/app/chat/actions.ts`
    (`sendChatMessageAction`) — parse @mentions here and emit notifications
  - `src/lib/scope.ts` / `src/domain/scope.ts` (`taskScopeWhere` — scope global search results)
  - `src/components/AppShell.tsx` (add a notifications inbox affordance in the top nav)
- the project skills `halevora-permissions-audit` (search results must be scoped) +
  `halevora-realtime-debug` (live notification delivery) + `halevora-qa-gate`

## 2. What Section 11 built (Realtime + per-board chat)
Live updates over **SSE + Postgres `LISTEN`/`NOTIFY`** (no Pusher/Ably): per-board chat, a
live board, and presence. **311 unit tests pass** (was 293; +18 for the realtime event codec
+ authorization predicate). Realtime is **additive** — every publish is best-effort and never
blocks a mutation; if the stream drops, the app stays correct on reload.

- **NOTIFY on writes.** `src/lib/realtime.ts` publishes a TINY, content-free event
  (`{ type, taskId?, boardId, messageId?, userId?, presence? }` — ids + type ONLY, never task
  titles/bodies/assignees/chat text) via `prisma.$executeRaw` `pg_notify` on the **pooled**
  `DATABASE_URL` (NOTIFY works through the transaction pooler; only LISTEN cannot). Wired into
  board create/move/status (`src/app/board/actions.ts`), all five bulk ops
  (`src/app/board/bulkActions.ts`), the board-visible task-detail mutations — status, priority,
  assignee, due, title (`src/app/board/task/actions.ts` via `revalidateAndPublishTask`), and
  chat send (`src/app/chat/actions.ts`).
- **SSE endpoint + LISTEN worker.** `src/app/api/stream/route.ts` (`runtime = "nodejs"`) opens
  an SSE stream per actor. `src/lib/realtimeListener.ts` holds ONE `pg.Client` per process on
  **`DIRECT_URL`** (the load-bearing decision — a pooled listener silently never receives
  notifications), ref-counts `LISTEN board_<id>`, and fans NOTIFYs out to in-memory SSE
  subscribers. Client disconnect drops the subscriber and `UNLISTEN`s when a channel empties.
  Reconnect-safe (re-LISTENs live channels on a new socket). Client hook: `src/components/
  useRealtime.ts` (EventSource, auto-reconnect).
- **Per-board chat.** `/chat` (`src/app/chat/{page,ChatClient,data,actions}.{tsx,ts}` +
  `chat.module.css`): a two-pane board-list + message panel, newest-last, author + time in the
  **actor's timezone**, send via an authorized server action. Live-delivered to other board
  viewers over the SSE stream (the body is re-fetched under scope on a `chat` event id — never
  broadcast). The Chat nav tab now routes here.
- **Presence.** A lightweight join/leave heartbeat over the same stream (publish on
  subscribe/disconnect); the chat panel shows "N others viewing"/"Only you".
- **Live board.** `src/app/board/Board.tsx` subscribes to its visible board channels and
  `router.refresh()`es on a `task` event (re-fetch is already scoped).

**SECURITY — the realtime leak gate (this is the heart of §11):**
- The pure rule is `canReceiveEvent(actor, event, visibility)` in `src/domain/realtime.ts`
  (TDD, 18 tests). The server supplies live visibility FACTS in `src/lib/realtimeScope.ts`
  (`actorMayReceive` → `isTaskVisible` / `isBoardVisible`), re-querying UNDER THE SUBSCRIBER'S
  SCOPE — never trusting the payload. `src/app/api/stream/route.ts:78` calls `actorMayReceive`
  before EVERY `sendEvent`, so a MEMBER never receives a `task` event for a task they can't see,
  nor `chat`/`presence` for a board they can't see — even though the NOTIFY is a board-wide
  broadcast. Fails CLOSED on any resolution error.
- **Chat board-visibility rule (documented decision):** a user may see a board's chat +
  presence iff they can see ≥1 task on that board. CEO → all boards; MEMBER → only boards where
  they are an assignee of ≥1 non-archived task. Implemented by `visibleBoardIds` /
  `isBoardVisible` (`src/lib/realtimeScope.ts`); the chat board list, the SSE subscription, and
  event delivery all use it so they agree.

## 3. Files added/changed
- `src/domain/realtime.ts` + `realtime.test.ts` — pure event model: channel naming, ids-only
  codec (defensive decode, never throws), `canReceiveEvent` authorization predicate (NEW, TDD).
- `src/lib/realtime.ts` — pooled `pg_notify` publish helper, best-effort (NEW).
- `src/lib/realtimeListener.ts` — singleton **DIRECT_URL** `pg` LISTEN worker + SSE fan-out hub,
  ref-counted, reconnect-safe (NEW).
- `src/lib/realtimeScope.ts` — per-subscriber server-side authorization (`actorMayReceive`,
  `isTaskVisible`, `isBoardVisible`, `visibleBoardIds`) (NEW).
- `src/app/api/stream/route.ts` — Node-runtime SSE endpoint; authorizes every event per
  subscriber (NEW).
- `src/components/useRealtime.ts` — client EventSource hook (events + presence) (NEW).
- `src/app/chat/{page,ChatClient,data,actions}.{tsx,ts}` + `chat.module.css` — per-board chat UI
  + scoped data + authorized send/fetch actions (page was a placeholder; rest NEW).
- `src/app/board/Board.tsx` — subscribe to board channels, live refresh on task events (CHANGED).
- `src/app/board/actions.ts` — publish task events on create/status/move (CHANGED).
- `src/app/board/bulkActions.ts` — publish task events per bulk op (CHANGED).
- `src/app/board/task/actions.ts` — `revalidateAndPublishTask` on board-visible detail edits
  (status/priority/assignee/due/title) (CHANGED).
- `package.json` / `package-lock.json` — added `pg` + `@types/pg` (CHANGED).

## 4. State of the world
- **Migrations:** unchanged — 4 migrations; `ChatMessage` already existed, so **no new
  migration**. `npx prisma validate` ok, `migrate status` "up to date".
- **Env needed:** `DATABASE_URL` (pooled — queries + NOTIFY), **`DIRECT_URL` (session, 5432 — the
  LISTEN worker)**, `AUTH_SECRET`, `ANTHROPIC_API_KEY`. Optional `SUPABASE_*` for attachments.
- **New dep:** `pg` (+ `@types/pg`) for the raw LISTEN client.
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`;
  log in `noel@halevora.com` / `halevora` (CEO) or `member1@halevora.com` / `halevora` (MEMBER).
- **Verified (this session):** `npm run typecheck` clean · `npm test` **311/311** ·
  `npm run build` clean (routes `/api/stream` + `/chat` present) · `npx prisma validate` +
  `migrate status` in sync.
- **Browser smoke (chrome-devtools, TWO isolated contexts — CEO + member1):**
  - Chat board list scoped: CEO sees Innovations/Client Success/Meta Ads; **member1 sees only
    Innovations + Meta Ads, NOT Client Success** (no assigned task there).
  - **Live chat:** Noel posted on Innovations → appeared on member1 **live, no reload**, author
    "Noel Pollak", time in member1's tz (11:43 AM vs CEO 2:43 PM — per-user tz works).
  - **Presence:** CEO showed "1 other viewing" when member1 joined Innovations.
  - **Live board:** CEO set a member1-assigned Meta Ads task TODO→IN PROGRESS → member1's board
    updated **live, no reload**.
  - **NO LEAK (the critical check):** CEO created "SECRET-NOEL-ONLY-TASK" on Innovations (Noel's
    only) → member1's Innovations count stayed **2**, the task never appeared, member1 received
    no event (server-filtered by `actorMayReceive`).
  - SSE connection streaming (`GET /api/stream?board=...` 200). **No console errors** in either
    context; no errors in the dev server log. Test artifacts cleaned up afterward.

## 5. Open issues / deferred (with TODO markers where relevant)
- **Presence has no snapshot-on-connect.** Presence is broadcast-only (join/leave), so a viewer
  who connects AFTER another is already present does not retroactively learn of them until the
  next event. Observed: when the member joined a board the CEO was already on, the CEO saw "1
  other viewing" but the member showed "Only you". Harmless; a §12/§13 fix is to reply with a
  presence snapshot on subscribe (track current viewers per channel in the hub).
- **Board live-refresh is coarse (`router.refresh()`).** A `task` event re-fetches the whole
  board rather than patching one card. Correct + scoped, but chattier than needed under heavy
  edit volume. Fine for the team's scale; a §13 optimization could patch a single card.
- **Single-process listener.** The hub is one `pg` client PER server process (handoff 00 §2
  model). If the app is ever horizontally scaled, each instance LISTENs independently — that is
  correct (Postgres fans NOTIFY to all listeners), but in-memory presence is per-instance.
- **Chat is not paged.** `loadBoardMessages` takes a recent window (100). A scrollback/pagination
  pass is a later polish item; chat history beyond the window is in the DB, just not loaded.
- **Chat has no @mentions yet** — that is Section 12 (parse + notify + live-deliver).

## 6. NEXT SECTION (Section 12): Notifications + @mentions + global search   — depends on §11
**Goal:** a notifications inbox with per-event notifications, @mentions in comments/chat, and a
scoped global search. All three reuse the §11 SSE stream for live delivery.

**Entry point:** extend the realtime model + add a `Notification` table, then layer the three
features. Notifications are **user-targeted** (unlike §11's board-broadcast events), so the
authorization model shifts from "may this actor see this board/task?" to "is this actor the
intended recipient?" — but search results must STILL be row-scoped with `taskScopeWhere`.

**First 3 steps:**
1. **Data + model.** Add a `Notification` model to `prisma/schema.prisma` (`id`, `recipientId`,
   `type` (`assigned`|`mentioned`|`commented`), `taskId?`/`boardId?`/`commentId?`, `actorId?`,
   `readAt?`, `createdAt`) and run a migration (`npm run db:migrate`). Index `(recipientId,
   readAt, createdAt)`. Keep any pure notification-building/parse logic in `src/domain` + TDD it.
2. **@mention parse + notify.** In `createCommentAction` (`src/app/board/task/actions.ts`) and
   `sendChatMessageAction` (`src/app/chat/actions.ts`), parse mentions (decide the token form,
   e.g. `@name` resolved against users, or a Tiptap mention node for comments). For each
   mentioned user — AND for "assigned to you" / "comment on your task" events — write a
   `Notification` row, then publish a live ping. Extend `src/domain/realtime.ts` with a
   `notification` event type (+ codec test) and add a recipient check to `src/lib/realtimeScope.ts`
   (`actorMayReceive`: a `notification` event is delivered ONLY to its `recipientId`). Build the
   inbox UI (a nav affordance in `AppShell.tsx` + a panel/page) that lists + marks-read and
   updates live over the SSE stream.
3. **Global search (SCOPED).** A search action/route that queries tasks by title/description
   composing `taskScopeWhere(actor)` so a MEMBER only ever finds tasks assigned to them (CEO
   finds all) — same invariant as every other read. Add a search affordance in the shell.

**Gotchas:**
- **Scope search like every other read.** A bare `prisma.task.findMany` in search is a leak —
  `halevora-permissions-audit` will flag it. AND `taskScopeWhere(actor)` into the query.
- **Notifications are user-targeted, not board-broadcast.** Reuse the SSE stream but add the
  recipient filter to `actorMayReceive` — a `notification` event must reach ONLY its recipient.
  A member must never receive a notification (nor an @mention ping) about a task/board they can't
  see; only mention users who can see the surface, or accept that being mentioned grants a
  notification but NOT task access (decide + document, mirroring §11's documented chat rule).
- **@mention parsing is pure** — put it in `src/domain` and TDD it (the mention-token grammar +
  user resolution shape), like §11's codec.
- Reuse `useRealtime` for the inbox live updates; subscribe per-user (you may need a `user_<id>`
  channel alongside the existing `board_<id>` channels, or carry `recipientId` and filter).
- Run `halevora-permissions-audit` (search + notifications) + `halevora-realtime-debug` (live
  delivery) + `halevora-qa-gate` before the §13 handoff. Browser-smoke across TWO contexts:
  confirm a member finds only their own tasks in search and receives only their own notifications.
