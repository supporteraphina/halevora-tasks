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
  encodeEvent,
  type RealtimeEvent,
} from "@/domain/realtime";

/**
 * Publish one event on a board's channel. `pg_notify(channel, payload)` is called via a
 * parameterized `$executeRaw` so neither the channel nor the payload can be injected. The
 * channel is always `board_<id>` for a known board id (cuid), and the payload is compact JSON.
 */
export async function publishEvent(
  boardId: string,
  event: Omit<RealtimeEvent, "boardId"> & { boardId?: string },
): Promise<void> {
  try {
    const full: RealtimeEvent = { ...event, boardId } as RealtimeEvent;
    const channel = boardChannel(boardId);
    const payload = encodeEvent(full);
    // pg_notify takes (text, text); both are bound parameters — no string interpolation.
    await prisma.$executeRaw`SELECT pg_notify(${channel}, ${payload})`;
  } catch {
    // Best-effort: realtime is additive. Never surface a publish error to the mutation.
  }
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
