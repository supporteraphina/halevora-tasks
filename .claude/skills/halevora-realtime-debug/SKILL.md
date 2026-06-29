---
name: halevora-realtime-debug
description: Debug and verify Halevora Tasks realtime (SSE + Postgres LISTEN/NOTIFY) and per-board chat. Checks that normal queries use the pooled DATABASE_URL while the LISTEN/NOTIFY worker uses the direct/session DIRECT_URL, that SSE reconnects cleanly, that live board and per-board chat update across two sessions, and that realtime events respect row-level permissions and never leak hidden task data. Use when building or debugging realtime, chat, SSE, or the NOTIFY worker.
user-invocable: true
---

# Halevora Realtime Debug

Realtime is **SSE + Postgres `NOTIFY`** (no Pusher/Ably). The connection split is
load-bearing.

## Connection invariant (check first — it is the #1 cause of "LISTEN does nothing")

- **Normal Prisma queries** use the **pooled** connection (`DATABASE_URL`, transaction
  pooler).
- **The `LISTEN/NOTIFY` worker** uses the **direct/session** connection (`DIRECT_URL`,
  port 5432). Supabase's transaction pooler cannot hold a `LISTEN`. If the worker is on the
  pooled URL, notifications silently never arrive — verify the worker opens its own client on
  `DIRECT_URL`.

## Checklist

1. **Worker connection** — the NOTIFY listener connects via `DIRECT_URL` (session/direct),
   not the pooled URL. App queries stay on the pooled `DATABASE_URL`.
2. **SSE lifecycle** — the SSE endpoint streams correctly, sends heartbeats/keep-alives, and
   the client **reconnects cleanly** after a drop (with `Last-Event-ID` or equivalent so no
   events are lost or duplicated on resume). No leaked connections on unmount.
3. **Live board** — open two browser sessions; a task create/move/edit in one appears in the
   other without a manual refresh.
4. **Per-board chat** — a message posted in one session appears live in the other, scoped to
   that board.
5. **Permissions in realtime** — this is the trap. A live event (board update, chat,
   notification) for a task a MEMBER cannot see must **not** be delivered to that member.
   Audit the server-side filter at publish/subscribe time — re-apply the row-level scope to
   the event payload, do not rely on the client to drop it. Cross-check with
   `halevora-permissions-audit`.
6. **Payload minimalism** — events carry only what the recipient is allowed to see; no
   hidden-task fields ride along in a broadcast.

## How to debug

- Confirm `NOTIFY` fires: tail the worker; issue a change; watch for the channel message.
- If queries work but realtime is dead, suspect the pooled-vs-direct split (item 1) before
  anything else.
- Reproduce reconnect by killing the SSE connection and confirming resume with no gap/dupe.
- Use two separate browser contexts (different users — one CEO, one MEMBER) to test both
  liveness and the permission filter at once.

## Output

Per-item PASS / FAIL. For failures, name the file:line and the root cause (especially if it
is the connection split). Verdict: **REALTIME OK** or **REALTIME FAIL** with the broken
behaviors and whether any failure is also a permission leak (escalate those).
