/**
 * SSE realtime stream. Node runtime (the LISTEN worker holds a raw `pg` socket — not Edge).
 *
 * GET /api/stream?board=<id>[&board=<id>...]  — opens a Server-Sent Events stream for the
 * current actor, subscribing to the named board channels. The client (useRealtime) re-fetches
 * or patches when an event arrives.
 *
 * SECURITY (the realtime leak gate):
 *  - The actor is resolved from the session here; an unauthenticated request gets 401.
 *  - Each requested board is checked with `isBoardVisible` — a member can only subscribe to
 *    boards they may see. A board they can't see is silently dropped from the subscription.
 *  - EVERY event is authorized per-subscriber with `actorMayReceive` (fresh re-query under
 *    scope) BEFORE it is written to this stream. A member NEVER receives a task event for a
 *    task they can't see, nor chat/presence for a board they can't see — even though the
 *    underlying NOTIFY is a board-wide broadcast. The payload carries only ids; nothing
 *    secret is on the wire.
 *
 * Lifecycle: a heartbeat comment keeps the connection warm and lets us detect a dead client;
 * on abort we unsubscribe every channel (ref-counted UNLISTEN) and announce presence leave.
 */
import { currentActor } from "@/lib/scope";
import { subscribeBoard } from "@/lib/realtimeListener";
import { actorMayReceive, isBoardVisible } from "@/lib/realtimeScope";
import { publishEvent } from "@/lib/realtime";
import { encodeEvent, type RealtimeEvent } from "@/domain/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  const maybeActor = await currentActor();
  if (!maybeActor) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Non-null alias so the value stays narrowed inside the closures below.
  const actor = maybeActor;

  const url = new URL(req.url);
  const requested = url.searchParams.getAll("board").filter(Boolean);

  // Authorize the requested boards: keep only those this actor may see.
  const allowed: string[] = [];
  for (const boardId of requested) {
    if (await isBoardVisible(actor, boardId)) allowed.push(boardId);
  }

  const encoder = new TextEncoder();
  const unsubscribers: Array<() => void> = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(line: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          // The client went away mid-write; cleanup runs via the abort handler.
        }
      }

      function sendEvent(event: RealtimeEvent) {
        send(`data: ${encodeEvent(event)}\n\n`);
      }

      // Initial comment + a "ready" event so the client knows the stream is live.
      send(`: connected\n\n`);
      send(`retry: 3000\n\n`);
      sendEvent({ type: "presence", boardId: "", userId: actor.userId, presence: "join" });

      // Subscribe to each allowed board. The hub routes by channel; we authorize per event.
      for (const boardId of allowed) {
        const unsub = await subscribeBoard(boardId, (event) => {
          // PER-SUBSCRIBER authorization — re-query under THIS actor's scope before forwarding.
          actorMayReceive(actor, event)
            .then((ok) => {
              if (ok) sendEvent(event);
            })
            .catch(() => {
              // Fail closed: a resolution error never forwards the event.
            });
        });
        unsubscribers.push(unsub);

        // Announce our presence to other viewers of this board (best-effort broadcast).
        await publishEvent(boardId, {
          type: "presence",
          userId: actor.userId,
          presence: "join",
        });
      }

      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
    },

    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    // Announce presence leave to the boards we were viewing (best-effort).
    for (const boardId of allowed) {
      void publishEvent(boardId, {
        type: "presence",
        userId: actor.userId,
        presence: "leave",
      });
    }
  }

  req.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy/CDN buffering so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
