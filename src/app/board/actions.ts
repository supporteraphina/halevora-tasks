"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import { STATUSES, isClosed, type Status } from "@/domain/status";
import { openBlockerCount } from "@/domain/dependencies";
import { maybeRecurOnStatusChange } from "@/lib/recurrenceTrigger";
import { onStatusChanged } from "@/lib/automationTrigger";
import { publishTaskEvent } from "@/lib/realtime";
import {
  appendOrder,
  orderForMove,
  needsRenormalize,
  renormalize,
} from "@/domain/ordering";

const BOARD_PATH = "/board";

export interface BoardActionState {
  error?: string;
  ok?: boolean;
}

/** Is the string one of the four STORED statuses? OVERDUE is never accepted. */
function isStoredStatus(v: string): v is Status {
  return (STATUSES as string[]).includes(v);
}

/**
 * Re-fetch a task the current actor is allowed to see, by composing the scope fragment
 * into the lookup. Returns null if the task does not exist OR the actor may not see it —
 * the caller treats both the same (never leak existence). NEVER trust a raw client id.
 */
async function findVisibleTask(taskId: string) {
  const actor = await requireActor();
  const task = await prisma.task.findFirst({
    where: { AND: [taskScopeWhere(actor), { id: taskId, archivedAt: null }] },
    select: { id: true, boardId: true, status: true, order: true },
  });
  return { actor, task };
}

/** A small fixed palette for new board accent dots, cycled by board count. */
const BOARD_COLORS = ["#7C5CFF", "#22C55E", "#F59E0B", "#EF4444", "#3B82F6", "#EC4899"];

/**
 * Create a new board (column) in the workspace's first project. Any signed-in user may create
 * one (creating a column is not a per-task READ, so it isn't scoped); we still re-authorize the
 * actor and resolve the project server-side rather than trusting a client-supplied id. If no
 * project exists yet, a default one is created so the very first board has a home.
 */
export async function createBoardAction(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  await requireActor();

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return { error: "Board name is required." };
  if (name.length > 120) return { error: "Board name is too long." };

  // Resolve the first project of the first workspace (mirrors the board loader's selection).
  const workspace = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, projects: { orderBy: { order: "asc" }, take: 1, select: { id: true } } },
  });
  if (!workspace) return { error: "No workspace exists yet." };

  let projectId = workspace.projects[0]?.id;
  if (!projectId) {
    const project = await prisma.project.create({
      data: { workspaceId: workspace.id, name: "Halevora", order: 0 },
      select: { id: true },
    });
    projectId = project.id;
  }

  const agg = await prisma.board.aggregate({
    where: { projectId },
    _max: { order: true },
    _count: true,
  });

  await prisma.board.create({
    data: {
      projectId,
      name,
      color: BOARD_COLORS[agg._count % BOARD_COLORS.length],
      order: appendOrder(agg._max.order),
    },
    select: { id: true },
  });

  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/**
 * Create a task into a board column. Default status TODO; order = max+1 in that column.
 * Any signed-in user may create (scoping is on READ); we still verify the board exists.
 */
export async function createTaskAction(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const actor = await requireActor();

  const boardId = String(formData.get("boardId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!boardId) return { error: "Missing board." };
  if (title.length === 0) return { error: "Task title is required." };
  if (title.length > 500) return { error: "Title is too long." };

  const board = await prisma.board.findFirst({
    where: { id: boardId, archivedAt: null },
    select: { id: true },
  });
  if (!board) return { error: "That board no longer exists." };

  // order = end of the column (max order + step). Counts every top-level card, unscoped,
  // so a member's new card sits after cards they can't see (positions stay globally sane).
  const max = await prisma.task.aggregate({
    where: { boardId, parentId: null, archivedAt: null },
    _max: { order: true },
  });

  const created = await prisma.task.create({
    data: {
      boardId,
      title,
      status: "TODO",
      order: appendOrder(max._max.order),
      createdById: actor.userId,
      // The creator is assigned by default so a MEMBER can see the card they just made.
      assignees: { connect: { id: actor.userId } },
    },
    select: { id: true },
  });

  // Live board: announce the new card (ids only — the relay re-authorizes per subscriber).
  await publishTaskEvent(boardId, created.id);
  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/**
 * Change a card's status. Writes only TODO/IN_PROGRESS/DONE/REVIEWED (never OVERDUE).
 * Re-authorizes: the task must be visible to the actor under scope before mutating.
 */
export async function changeStatusAction(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const status = String(formData.get("status") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Missing task." };
  if (!isStoredStatus(status)) return { error: "Unknown status." };

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // Done-gate (handoff 06 §6.3), server-enforced on the board path too: refuse closing
  // (DONE / REVIEWED) while any blocker is still open. Reads blockers fresh from the DB and
  // judges with the same pure `openBlockerCount`; never trusts the client.
  if (isClosed(status) && !isClosed(task.status)) {
    const blockers = await prisma.taskDependency.findMany({
      where: { blockedId: task.id },
      select: { blocker: { select: { status: true } } },
    });
    const open = openBlockerCount(blockers.map((b) => ({ status: b.blocker.status })));
    if (open > 0) {
      return { error: `Blocked by ${open} open task${open === 1 ? "" : "s"}.` };
    }
  }

  if (task.status !== status) {
    await prisma.task.update({ where: { id: task.id }, data: { status } });
    // Inline ON_STATUS_CHANGE recurrence — mirrored from the detail `setStatusAction`,
    // exactly as the Done-gate was mirrored across both status paths.
    await maybeRecurOnStatusChange({
      taskId: task.id,
      oldStatus: task.status,
      newStatus: status,
      actorId: actor.userId,
      timeZone: actor.timezone,
    });
    // Automation: fire status_changed rules for this board (best-effort; system writes).
    await onStatusChanged({
      boardId: task.boardId,
      taskId: task.id,
      actorId: actor.userId,
      from: task.status,
      to: status,
    });
    // Live board: announce the status change.
    await publishTaskEvent(task.boardId, task.id);
  }
  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/**
 * Move a card to another board column (changes boardId) and/or reorder it within a column.
 * `index` is the desired final slot in the destination column. Reordering writes one row:
 * the moved card gets a midpoint order between its new neighbors. If the column's orders
 * have collided/crowded, the whole column is renormalized in a transaction.
 */
export async function moveCardAction(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const toBoardId = String(formData.get("toBoardId") ?? "");
  const index = Number(formData.get("index") ?? "0");
  if (!taskId) return { error: "Missing task." };
  if (!toBoardId) return { error: "Missing destination." };
  if (!Number.isFinite(index) || index < 0) return { error: "Bad position." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };
  const fromBoardId = task.boardId;

  const destBoard = await prisma.board.findFirst({
    where: { id: toBoardId, archivedAt: null },
    select: { id: true },
  });
  if (!destBoard) return { error: "That board no longer exists." };

  // Destination neighbors = the column's current top-level cards EXCLUDING the moved one,
  // by order. Counted UNSCOPED so positions are globally consistent across viewers.
  const neighbors = await prisma.task.findMany({
    where: {
      boardId: toBoardId,
      parentId: null,
      archivedAt: null,
      id: { not: task.id },
    },
    orderBy: { order: "asc" },
    select: { id: true, order: true },
  });

  const targetOrder = orderForMove(
    neighbors.map((n) => n.order),
    Math.trunc(index),
  );

  // Build the post-move ascending order list to check for collisions.
  const after = [...neighbors.map((n) => n.order), targetOrder].sort(
    (a, b) => a - b,
  );

  if (needsRenormalize(after)) {
    // Respace the whole destination column in one transaction, placing the moved card
    // at the requested slot.
    const slot = Math.min(Math.trunc(index), neighbors.length);
    const ids = [
      ...neighbors.slice(0, slot).map((n) => n.id),
      task.id,
      ...neighbors.slice(slot).map((n) => n.id),
    ];
    const fresh = renormalize(ids.length);
    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: { boardId: toBoardId },
      }),
      ...ids.map((id, i) =>
        prisma.task.update({ where: { id }, data: { order: fresh[i] } }),
      ),
    ]);
  } else {
    await prisma.task.update({
      where: { id: task.id },
      data: { boardId: toBoardId, order: targetOrder },
    });
  }

  // Live board: announce on BOTH the source and destination boards so viewers of either
  // refresh (a cross-board move removes the card from one column and adds it to another).
  await publishTaskEvent(toBoardId, task.id);
  if (fromBoardId !== toBoardId) await publishTaskEvent(fromBoardId, task.id);
  revalidatePath(BOARD_PATH);
  return { ok: true };
}
