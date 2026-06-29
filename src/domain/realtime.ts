/**
 * Realtime event model. Pure, framework-free domain logic.
 *
 * Section 11 pushes live updates over SSE + Postgres LISTEN/NOTIFY. A NOTIFY payload is
 * deliberately TINY: an event type plus the ids needed to (re-)authorize and (re-)fetch on
 * the client. It NEVER carries task content — titles, descriptions, assignees, chat bodies
 * stay out of the broadcast. That keeps the broadcast cheap AND means a leak can only happen
 * if the SERVER forwards an event it should have filtered (the codec carries nothing secret).
 *
 * THE security rule (mirrors src/domain/scope.ts): before the SSE relay forwards an event to
 * a given subscriber, it asks `canReceiveEvent(actor, event, ctx)`. A MEMBER must never learn
 * — even that a task EXISTS — via a realtime ping for a task not assigned to them. So:
 *   - a `task` / `board` event names a `taskId`; the relay re-queries that task UNDER the
 *     subscriber's scope and only forwards when it comes back (visibility proven server-side,
 *     per-subscriber, against fresh data — never trusting the payload).
 *   - a `chat` / `presence` event is per board; the relay forwards only to subscribers who may
 *     see that board (CEO: all boards; MEMBER: boards where they are assigned to >=1 task).
 *
 * This module owns the wire shape + the pure predicate. The relay (src/lib/realtime.ts +
 * the SSE route) supplies the live visibility facts; it never re-decides the rule.
 */

import type { ScopeActor } from "./scope";

/** Event kinds carried over the stream. Small, additive, ids-only. */
export type RealtimeEventType =
  | "task" // a task was created/moved/status/edited/archived (board liveness)
  | "chat" // a new chat message on a board
  | "presence"; // a viewer joined/left a board (heartbeat)

/** The minimal, content-free wire payload. */
export interface RealtimeEvent {
  type: RealtimeEventType;
  /** Present for `task` events (board liveness). The relay re-authorizes this id per subscriber. */
  taskId?: string;
  /** Present for `task` (which board to refresh), `chat`, and `presence` events. */
  boardId?: string;
  /** Present for `chat` — the message id (the client re-fetches the message body under scope). */
  messageId?: string;
  /** Present for `presence` — who is viewing and whether joining/leaving. Names resolved client-side. */
  userId?: string;
  presence?: "join" | "leave";
}

/** Channel a board's chat + presence + task-liveness events publish on. ONE channel per board. */
export function boardChannel(boardId: string): string {
  return `board_${boardId}`;
}

/**
 * Postgres channel identifiers are limited (63 bytes) and `pg_notify`'s first arg is an
 * identifier-like string. Board ids are cuids (lowercase alnum) so `board_<cuid>` is always
 * safe; we still defensively assert the shape so a malformed id can never inject SQL via the
 * channel name (the publish helper uses a parameterized `pg_notify`, but this is belt-and-braces).
 */
export function isValidChannel(channel: string): boolean {
  return /^board_[a-z0-9]+$/.test(channel) && channel.length <= 63;
}

/** Encode an event to the compact JSON string carried in the NOTIFY payload. */
export function encodeEvent(event: RealtimeEvent): string {
  return JSON.stringify(event);
}

/**
 * Decode a NOTIFY payload back to an event, defensively. Returns null for anything that is not
 * a well-formed event of a known type (a malformed/foreign payload is simply dropped, never
 * forwarded). NEVER throws — a bad payload must not kill the listener.
 */
export function decodeEvent(payload: string): RealtimeEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type !== "task" && type !== "chat" && type !== "presence") return null;

  const event: RealtimeEvent = { type };
  if (typeof o.taskId === "string") event.taskId = o.taskId;
  if (typeof o.boardId === "string") event.boardId = o.boardId;
  if (typeof o.messageId === "string") event.messageId = o.messageId;
  if (typeof o.userId === "string") event.userId = o.userId;
  if (o.presence === "join" || o.presence === "leave") event.presence = o.presence;

  // Per-type minimum: every event must carry a boardId (the routing key). A `task` event must
  // additionally name the task it concerns; a `chat` event its message id.
  if (!event.boardId) return null;
  if (type === "task" && !event.taskId) return null;
  if (type === "chat" && !event.messageId) return null;
  if (type === "presence" && (!event.userId || !event.presence)) return null;
  return event;
}

/**
 * Per-subscriber authorization decision facts the relay gathers fresh from the DB before asking
 * `canReceiveEvent`. The relay NEVER trusts the payload for these — it re-queries under scope.
 *   - `taskVisible`: for a `task` event, did re-querying `event.taskId` UNDER the subscriber's
 *     scope return a row? (undefined when not a task event.)
 *   - `boardVisible`: for a `chat`/`presence` event, may this subscriber see this board at all?
 */
export interface EventVisibility {
  taskVisible?: boolean;
  boardVisible?: boolean;
}

/**
 * THE per-subscriber realtime authorization predicate. Pure: given the subscriber's role and
 * the freshly-resolved visibility facts, decide whether this event may be delivered.
 *
 *   - CEO sees everything → always true (still requires the relay to have resolved the board/task,
 *     but a CEO's re-query always succeeds, so the facts come back true).
 *   - `task` event → deliver only when the task is visible to this subscriber RIGHT NOW.
 *   - `chat` / `presence` event → deliver only when the board is visible to this subscriber.
 *
 * A MEMBER for whom the fact is false (or unresolved) gets nothing — they cannot even learn the
 * task/board exists. This is the function `halevora-permissions-audit` checks for the realtime
 * surface; keep it pure and exhaustively tested.
 */
export function canReceiveEvent(
  actor: ScopeActor,
  event: RealtimeEvent,
  visibility: EventVisibility,
): boolean {
  if (actor.role === "CEO") return true;
  switch (event.type) {
    case "task":
      return visibility.taskVisible === true;
    case "chat":
    case "presence":
      return visibility.boardVisible === true;
    default:
      return false;
  }
}
