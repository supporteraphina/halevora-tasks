"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { requireActor, type SessionActor } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import { isClosed, type Status } from "@/domain/status";
import { openBlockerCount } from "@/domain/dependencies";
import { normalizeTagName } from "@/domain/taskDetail";
import {
  parseTaskIds,
  isBulkStatusOp,
  isBulkPriorityOp,
  type BulkResult,
} from "@/domain/bulk";
import { recordActivity } from "@/lib/activity";
import { publishTaskEvent } from "@/lib/realtime";
import { maybeRecurOnStatusChange } from "@/lib/recurrenceTrigger";
import {
  onStatusChanged,
  onPriorityChanged,
  onAssigneeChanged,
  onTagAdded,
} from "@/lib/automationTrigger";

const BOARD_PATH = "/board";
const VIEW_PATHS = ["/my-tasks", "/all-tasks", "/today", "/reviewed", "/calendar"];

export interface BulkActionState {
  error?: string;
  ok?: boolean;
  result?: BulkResult;
}

function revalidateAll() {
  revalidatePath(BOARD_PATH);
  for (const p of VIEW_PATHS) revalidatePath(p);
}

/**
 * THE batch authorization gate. Resolve the subset of the requested ids the actor may ACTUALLY
 * see, via ONE scoped query whose `where` composes `taskScopeWhere(actor)` AND `id IN (ids)`.
 * A foreign/injected id simply doesn't come back — it can never be mutated. The returned rows
 * carry the minimal columns the batch ops need. Subtasks (parentId set) are included only when
 * the actor is assigned to them (the scope fragment is per-row), matching the single-task path.
 *
 * SECURITY: a member can only bulk-edit tasks they can see because the visibility fragment is
 * enforced IN THIS QUERY. No mutation below ever runs against an id not returned here.
 */
async function authorizeBatch(actor: SessionActor, ids: string[]) {
  if (ids.length === 0) return [];
  return prisma.task.findMany({
    where: { AND: [taskScopeWhere(actor), { id: { in: ids }, archivedAt: null }] },
    select: {
      id: true,
      boardId: true,
      status: true,
      priority: true,
    },
  });
}

/** Read the selection ids from the form and resolve the actor + authorized visible subset. */
async function loadSelection(formData: FormData) {
  const actor = await requireActor();
  const ids = parseTaskIds(String(formData.get("taskIds") ?? ""));
  const visible = await authorizeBatch(actor, ids);
  return { actor, ids, visible };
}

// --- Bulk status ------------------------------------------------------------

/**
 * Set the status of every SELECTED, VISIBLE task. Honors the Done-gate per task exactly like
 * the single-task path: a task with any open blocker is REFUSED a close (DONE/REVIEWED) and
 * counted as `blocked`, never silently forced. Fires the same inline recurrence + automation
 * hooks per task (capped to the authorized subset) so a bulk close behaves like N single closes.
 */
export async function bulkSetStatusAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  const status = String(formData.get("status") ?? "");
  if (!isBulkStatusOp(status)) return { error: "Unknown status." };

  const { actor, visible } = await loadSelection(formData);
  if (visible.length === 0) return { error: "No tasks you can edit were selected." };

  const result: BulkResult = { updated: 0, skipped: 0, blocked: 0 };

  for (const task of visible) {
    if (task.status === status) continue; // no-op, don't count as updated

    // Done-gate: refuse closing while any blocker is still open (read fresh, never trust client).
    if (isClosed(status as Status) && !isClosed(task.status)) {
      const blockers = await prisma.taskDependency.findMany({
        where: { blockedId: task.id },
        select: { blocker: { select: { status: true } } },
      });
      const open = openBlockerCount(blockers.map((b) => ({ status: b.blocker.status })));
      if (open > 0) {
        result.blocked++;
        continue;
      }
    }

    await prisma.task.update({ where: { id: task.id }, data: { status } });
    await recordActivity({
      taskId: task.id,
      boardId: task.boardId,
      actorId: actor.userId,
      type: "status_changed",
      data: { from: task.status, to: status },
    });
    await maybeRecurOnStatusChange({
      taskId: task.id,
      oldStatus: task.status,
      newStatus: status as Status,
      actorId: actor.userId,
      timeZone: actor.timezone,
    });
    await onStatusChanged({
      boardId: task.boardId,
      taskId: task.id,
      actorId: actor.userId,
      from: task.status,
      to: status as Status,
    });
    await publishTaskEvent(task.boardId, task.id);
    result.updated++;
  }

  revalidateAll();
  return { ok: true, result };
}

// --- Bulk priority ----------------------------------------------------------

/**
 * Set the priority of every SELECTED, VISIBLE task via ONE scoped `updateMany` whose `where`
 * composes `taskScopeWhere(actor)` — scope is enforced IN THE QUERY, so an injected foreign id
 * is impossible to touch. We then emit per-task activity + fire the priority automation only for
 * tasks whose priority actually changed (read before the update), keeping behavior parity with
 * the single-task path while bounding cost to the authorized subset.
 */
export async function bulkSetPriorityAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  const priority = String(formData.get("priority") ?? "");
  if (!isBulkPriorityOp(priority)) return { error: "Unknown priority." };

  const { actor, ids, visible } = await loadSelection(formData);
  if (visible.length === 0) return { error: "No tasks you can edit were selected." };

  const changed = visible.filter((t) => t.priority !== priority);

  // Scoped batch write — visibility is enforced in the `where` itself.
  await prisma.task.updateMany({
    where: { AND: [taskScopeWhere(actor), { id: { in: ids }, archivedAt: null }] },
    data: { priority },
  });

  for (const task of changed) {
    await recordActivity({
      taskId: task.id,
      boardId: task.boardId,
      actorId: actor.userId,
      type: "bulk_updated",
      data: { field: "priority", to: priority },
    });
    await onPriorityChanged({
      boardId: task.boardId,
      taskId: task.id,
      actorId: actor.userId,
      from: task.priority,
      to: priority,
    });
    await publishTaskEvent(task.boardId, task.id);
  }

  revalidateAll();
  return {
    ok: true,
    result: { updated: changed.length, skipped: visible.length - changed.length, blocked: 0 },
  };
}

// --- Bulk assignee ----------------------------------------------------------

/**
 * Add or remove one assignee across the SELECTED, VISIBLE tasks. The picked user must exist
 * (any signed-in user may be assigned to anyone — scoping is on READ). Each task is mutated
 * only after the scoped `authorizeBatch` proved the actor may see it (relation changes can't be
 * expressed by a single `updateMany`, so we loop the authorized subset and re-auth is implicit
 * in that subset). Fires the assignee automation per task.
 */
export async function bulkToggleAssigneeAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  const userId = String(formData.get("userId") ?? "");
  const op = String(formData.get("op") ?? "");
  if (!userId) return { error: "Pick a person." };
  if (op !== "add" && op !== "remove") return { error: "Bad operation." };

  const { actor, visible } = await loadSelection(formData);
  if (visible.length === 0) return { error: "No tasks you can edit were selected." };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
  });
  if (!user) return { error: "That user no longer exists." };

  for (const task of visible) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        assignees:
          op === "add"
            ? { connect: { id: userId } }
            : { disconnect: { id: userId } },
      },
    });
    await recordActivity({
      taskId: task.id,
      boardId: task.boardId,
      actorId: actor.userId,
      type: op === "add" ? "assignee_added" : "assignee_removed",
      data: { name: user.name },
    });
    if (op === "add") {
      await onAssigneeChanged({
        boardId: task.boardId,
        taskId: task.id,
        actorId: actor.userId,
        userId,
      });
    }
    await publishTaskEvent(task.boardId, task.id);
  }

  revalidateAll();
  return { ok: true, result: { updated: visible.length, skipped: 0, blocked: 0 } };
}

// --- Bulk tag ---------------------------------------------------------------

/**
 * Add or remove one tag across the SELECTED, VISIBLE tasks. On "add" by name we upsert the tag
 * (global, by unique name) then connect it; on "remove" we disconnect by tag id. Each task is in
 * the scoped authorized subset before mutation. Fires the tag_added automation per task on add.
 */
export async function bulkToggleTagAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  const op = String(formData.get("op") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  const name = normalizeTagName(String(formData.get("name") ?? ""));
  if (op !== "add" && op !== "remove") return { error: "Bad operation." };

  const { actor, visible } = await loadSelection(formData);
  if (visible.length === 0) return { error: "No tasks you can edit were selected." };

  // Resolve the tag: by id (remove / existing add) or by name (create-and-add).
  let tag: { id: string; name: string } | null = null;
  if (tagId) {
    tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { id: true, name: true } });
  } else if (op === "add" && name.length > 0) {
    if (name.length > 50) return { error: "Tag name is too long." };
    tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true, name: true },
    });
  }
  if (!tag) return { error: "Pick or name a tag." };

  for (const task of visible) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        tags:
          op === "add"
            ? { connect: { id: tag.id } }
            : { disconnect: { id: tag.id } },
      },
    });
    await recordActivity({
      taskId: task.id,
      boardId: task.boardId,
      actorId: actor.userId,
      type: "bulk_updated",
      data: { field: op === "add" ? "tag added" : "tag removed", tag: tag.name },
    });
    if (op === "add") {
      await onTagAdded({
        boardId: task.boardId,
        taskId: task.id,
        actorId: actor.userId,
        tagName: tag.name,
      });
    }
    await publishTaskEvent(task.boardId, task.id);
  }

  revalidateAll();
  return { ok: true, result: { updated: visible.length, skipped: 0, blocked: 0 } };
}

// --- Bulk archive (soft-delete) ---------------------------------------------

/**
 * Archive (soft-delete) every SELECTED, VISIBLE task via ONE scoped `updateMany` whose `where`
 * composes `taskScopeWhere(actor)` — an injected foreign id is impossible to archive. This sets
 * `archivedAt` and NEVER hard-deletes (handoff 00 §5). The task leaves the board + list views
 * (every read filters `archivedAt: null`). Per-task activity is appended for the archived subset.
 */
export async function bulkArchiveAction(
  _prev: BulkActionState,
  formData: FormData,
): Promise<BulkActionState> {
  const { actor, ids, visible } = await loadSelection(formData);
  if (visible.length === 0) return { error: "No tasks you can edit were selected." };

  const now = new Date();
  // Scoped soft-delete — visibility enforced in the `where`. Only not-yet-archived rows match.
  const res = await prisma.task.updateMany({
    where: {
      AND: [taskScopeWhere(actor), { id: { in: ids }, archivedAt: null }],
    },
    data: { archivedAt: now },
  });

  for (const task of visible) {
    await recordActivity({
      taskId: task.id,
      boardId: task.boardId,
      actorId: actor.userId,
      type: "bulk_updated",
      data: { field: "archived" },
    });
    // Live board: the card leaves every view; tell viewers of its board to refresh.
    await publishTaskEvent(task.boardId, task.id);
  }

  revalidateAll();
  return { ok: true, result: { updated: res.count, skipped: 0, blocked: 0 } };
}
