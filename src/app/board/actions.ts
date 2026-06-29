"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import { STATUSES, type Status } from "@/domain/status";
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

  await prisma.task.create({
    data: {
      boardId,
      title,
      status: "TODO",
      order: appendOrder(max._max.order),
      createdById: actor.userId,
      // The creator is assigned by default so a MEMBER can see the card they just made.
      assignees: { connect: { id: actor.userId } },
    },
  });

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

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  await prisma.task.update({ where: { id: task.id }, data: { status } });
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

  revalidatePath(BOARD_PATH);
  return { ok: true };
}
