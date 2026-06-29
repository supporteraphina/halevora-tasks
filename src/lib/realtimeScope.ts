/**
 * Realtime per-subscriber authorization — the SERVER-SIDE filter that decides, for a specific
 * actor, whether a realtime event may be delivered to them. Server-only.
 *
 * This is the realtime leak gate `halevora-permissions-audit` checks. The pure RULE lives in
 * src/domain/realtime.ts (`canReceiveEvent`); this file supplies the live visibility FACTS by
 * re-querying the DB UNDER THE SUBSCRIBER'S SCOPE — never trusting the event payload:
 *   - task events  → is `event.taskId` visible to THIS actor right now? (scoped findFirst)
 *   - chat/presence → may THIS actor see this board at all?
 *
 * Board visibility rule (documented decision, handoff 11 §security): a user may see a board's
 * chat + presence iff they can see at least one task on that board. A CEO sees all boards; a
 * MEMBER sees only boards where they are an assignee of >=1 non-archived task. This keeps chat
 * inside the same row-level model — a member never receives chat/presence (nor learns a board
 * exists) for a board they have no task visibility into.
 */
import prisma from "@/lib/prisma";
import type { SessionActor } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import {
  canReceiveEvent,
  type RealtimeEvent,
  type EventVisibility,
} from "@/domain/realtime";

/** Is `taskId` visible to this actor right now? Scoped findFirst — existence is never leaked. */
export async function isTaskVisible(
  actor: SessionActor,
  taskId: string,
): Promise<boolean> {
  if (actor.role === "CEO") {
    const t = await prisma.task.findFirst({ where: { id: taskId }, select: { id: true } });
    return t !== null;
  }
  const t = await prisma.task.findFirst({
    where: { AND: [taskScopeWhere(actor), { id: taskId }] },
    select: { id: true },
  });
  return t !== null;
}

/**
 * May this actor see this board (its chat + presence)? CEO: always (board exists). MEMBER: only
 * when they are an assignee of at least one non-archived task on the board.
 */
export async function isBoardVisible(
  actor: SessionActor,
  boardId: string,
): Promise<boolean> {
  if (actor.role === "CEO") {
    const b = await prisma.board.findFirst({
      where: { id: boardId, archivedAt: null },
      select: { id: true },
    });
    return b !== null;
  }
  const t = await prisma.task.findFirst({
    where: {
      AND: [
        taskScopeWhere(actor),
        { boardId, archivedAt: null, board: { archivedAt: null } },
      ],
    },
    select: { id: true },
  });
  return t !== null;
}

/**
 * The full per-subscriber decision: resolve the live visibility facts for `event` under
 * `actor`, then apply the pure rule. Returns true only when this actor may receive this event.
 * Fails CLOSED — any error resolving the facts denies delivery.
 */
export async function actorMayReceive(
  actor: SessionActor,
  event: RealtimeEvent,
): Promise<boolean> {
  try {
    const visibility: EventVisibility = {};
    if (event.type === "notification") {
      // User-targeted: no DB fact needed — recipient equality is the whole rule (pure predicate).
      // A notification ping carries no task/board secret; the inbox re-fetches under scope.
      return canReceiveEvent(actor, event, visibility);
    }
    if (event.type === "task") {
      visibility.taskVisible = event.taskId
        ? await isTaskVisible(actor, event.taskId)
        : false;
    } else {
      // chat | presence — board-scoped
      visibility.boardVisible = event.boardId
        ? await isBoardVisible(actor, event.boardId)
        : false;
    }
    return canReceiveEvent(actor, event, visibility);
  } catch {
    return false;
  }
}

/** The set of board ids this actor may see — used to scope the chat board list + presence. */
export async function visibleBoardIds(actor: SessionActor): Promise<Set<string>> {
  if (actor.role === "CEO") {
    const boards = await prisma.board.findMany({
      where: { archivedAt: null },
      select: { id: true },
    });
    return new Set(boards.map((b) => b.id));
  }
  const rows = await prisma.task.findMany({
    where: {
      AND: [taskScopeWhere(actor), { archivedAt: null, board: { archivedAt: null } }],
    },
    select: { boardId: true },
    distinct: ["boardId"],
  });
  return new Set(rows.map((r) => r.boardId));
}
