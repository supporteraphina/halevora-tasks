/**
 * Realtime PUBLISH side. Server-only.
 *
 * Emits a Postgres NOTIFY carrying a tiny, content-free event (see src/domain/realtime.ts)
 * so the SSE relay can wake subscribers. Publishing uses the POOLED connection (`prisma`,
 * `DATABASE_URL`) — `NOTIFY` works fine through the transaction pooler; only LISTEN cannot.
 * The LISTEN worker on the other end uses `DIRECT_URL` (see src/lib/realtimeListener.ts).
 *
 * ADDITIVE + best-effort: a publish failure NEVER fails the mutation that triggered it.
 * Realtime is a nicety; the app stays correct on reload if the stream drops. So every
 * publish is wrapped and swallows its own errors, exactly like recordActivity.
 *
 * SECURITY: the payload carries only an event type + ids. No titles, bodies, assignees, or
 * chat text ride along. The relay re-authorizes each event per subscriber before forwarding,
 * so even a broadcast NOTIFY leaks nothing — the wire has nothing secret on it.
 */
import prisma from "@/lib/prisma";
import {
  boardChannel,
  userChannel,
  encodeEvent,
  type RealtimeEvent,
} from "@/domain/realtime";

/**
 * Low-level publish: NOTIFY one already-built event on an explicit channel. `pg_notify(channel,
 * payload)` is called via a parameterized `$executeRaw` so neither the channel nor the payload
 * can be injected. The channel is always `board_<id>` or `user_<id>` for a known cuid; the
 * payload is compact, ids-only JSON. Best-effort — a publish failure never fails the mutation.
 */
async function notifyChannel(channel: string, event: RealtimeEvent): Promise<void> {
  try {
    const payload = encodeEvent(event);
    // pg_notify takes (text, text); both are bound parameters — no string interpolation.
    await prisma.$executeRaw`SELECT pg_notify(${channel}, ${payload})`;
  } catch {
    // Best-effort: realtime is additive. Never surface a publish error to the mutation.
  }
}

/**
 * Publish one event on a BOARD's channel (board-broadcast: task liveness, chat, presence).
 * Each subscriber is re-authorized per event by the SSE relay, so a board-wide NOTIFY is safe.
 */
export async function publishEvent(
  boardId: string,
  event: Omit<RealtimeEvent, "boardId"> & { boardId?: string },
): Promise<void> {
  const full: RealtimeEvent = { ...event, boardId } as RealtimeEvent;
  await notifyChannel(boardChannel(boardId), full);
}

/** Convenience: announce that a task changed (created/moved/status/edited/archived). */
export async function publishTaskEvent(boardId: string, taskId: string): Promise<void> {
  await publishEvent(boardId, { type: "task", taskId });
}

/** Convenience: announce a new chat message on a board. */
export async function publishChatEvent(
  boardId: string,
  messageId: string,
): Promise<void> {
  await publishEvent(boardId, { type: "chat", messageId });
}

/**
 * Publish a NOTIFICATION ping on ONE recipient's `user_<id>` channel (user-targeted, NOT
 * board-broadcast). The SSE relay additionally asserts the subscriber's id equals
 * `recipientId`, so even a wrong channel could never deliver to the wrong person. Ids only —
 * no notification content rides the wire; the inbox re-fetches the unread list under scope.
 */
export async function publishNotification(
  recipientId: string,
  boardId?: string,
): Promise<void> {
  await notifyChannel(userChannel(recipientId), {
    type: "notification",
    recipientId,
    ...(boardId ? { boardId } : {}),
  });
}
