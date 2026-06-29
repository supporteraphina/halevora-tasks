"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import { STATUSES, type Status } from "@/domain/status";
import { PRIORITIES, type Priority } from "@/domain/priority";
import { appendOrder } from "@/domain/ordering";
import { parseDateInput, quickChoiceDate, QUICK_CHOICES } from "@/domain/dates";
import { parseTimeEstimate, normalizeTagName } from "@/domain/taskDetail";

const BOARD_PATH = "/board";

export interface DetailActionState {
  error?: string;
  ok?: boolean;
}

function isStoredStatus(v: string): v is Status {
  return (STATUSES as string[]).includes(v);
}
function isPriority(v: string): v is Priority {
  return (PRIORITIES as string[]).includes(v);
}

/**
 * Re-fetch a task the current actor may see, composing the scope fragment into the
 * lookup. Returns null when the task doesn't exist OR the actor may not see it — the
 * caller treats both the same (never leak existence). NEVER trust a raw client id.
 *
 * This is the §3 `findVisibleTask` gate, re-used so every detail mutation re-authorizes
 * server-side against the client-supplied task id.
 */
async function findVisibleTask(taskId: string) {
  const actor = await requireActor();
  const task = await prisma.task.findFirst({
    where: { AND: [taskScopeWhere(actor), { id: taskId, archivedAt: null }] },
    select: { id: true, boardId: true, status: true },
  });
  return { actor, task };
}

/** Revalidate the board grid + the detail surface for a task. */
function revalidateTask(taskId: string) {
  revalidatePath(BOARD_PATH);
  revalidatePath(`/board/task/${taskId}`);
}

// --- Status -----------------------------------------------------------------

/** Change a task's status. Writes only the four STORED statuses (never OVERDUE). */
export async function setStatusAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!taskId) return { error: "Missing task." };
  if (!isStoredStatus(status)) return { error: "Unknown status." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  await prisma.task.update({ where: { id: task.id }, data: { status } });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Priority ---------------------------------------------------------------

export async function setPriorityAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const priority = String(formData.get("priority") ?? "");
  if (!taskId) return { error: "Missing task." };
  if (!isPriority(priority)) return { error: "Unknown priority." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  await prisma.task.update({ where: { id: task.id }, data: { priority } });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Assignees --------------------------------------------------------------

/**
 * Add or remove an assignee. NOTE: a MEMBER removing themselves removes their own
 * visibility of the card (scoping is on READ). That's allowed and deliberate — we don't
 * special-case it, but the UI warns before the action.
 */
export async function toggleAssigneeAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const op = String(formData.get("op") ?? ""); // "add" | "remove"
  if (!taskId) return { error: "Missing task." };
  if (!userId) return { error: "Missing user." };
  if (op !== "add" && op !== "remove") return { error: "Bad operation." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // The picked user must exist (any signed-in user may assign to anyone).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { error: "That user no longer exists." };

  await prisma.task.update({
    where: { id: task.id },
    data: {
      assignees:
        op === "add"
          ? { connect: { id: userId } }
          : { disconnect: { id: userId } },
    },
  });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Dates ------------------------------------------------------------------

/**
 * Set start / due date from the picker. `field` is "start" | "due". `mode` is either
 * "date" (a YYYY-MM-DD from the input), "quick" (one of QUICK_CHOICES), or "clear".
 * Dates are stored as the UTC instant marking local midnight of the chosen day in the
 * actor's timezone (see src/domain/dates.ts).
 */
export async function setDateAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const field = String(formData.get("field") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!taskId) return { error: "Missing task." };
  if (field !== "start" && field !== "due") return { error: "Bad date field." };

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  let value: Date | null;
  if (mode === "clear") {
    value = null;
  } else if (mode === "quick") {
    const key = String(formData.get("quick") ?? "");
    const spec = QUICK_CHOICES.find((c) => c.key === key);
    if (!spec) return { error: "Unknown quick choice." };
    value = quickChoiceDate(spec.key, new Date(), actor.timezone);
  } else if (mode === "date") {
    const raw = String(formData.get("date") ?? "");
    value = parseDateInput(raw, actor.timezone);
    if (value === null) return { error: "That date is not valid." };
  } else {
    return { error: "Bad date mode." };
  }

  await prisma.task.update({
    where: { id: task.id },
    data: field === "start" ? { startAt: value } : { dueAt: value },
  });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Time estimate ----------------------------------------------------------

export async function setTimeEstimateAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Missing task." };

  const parsed = parseTimeEstimate(String(formData.get("minutes") ?? ""));
  if (!parsed.ok) return { error: parsed.error };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  await prisma.task.update({
    where: { id: task.id },
    data: { timeEstimate: parsed.value },
  });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Tags -------------------------------------------------------------------

/** Connect an existing tag, or disconnect it. */
export async function toggleTagAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  const op = String(formData.get("op") ?? "");
  if (!taskId) return { error: "Missing task." };
  if (!tagId) return { error: "Missing tag." };
  if (op !== "add" && op !== "remove") return { error: "Bad operation." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  await prisma.task.update({
    where: { id: task.id },
    data: {
      tags:
        op === "add" ? { connect: { id: tagId } } : { disconnect: { id: tagId } },
    },
  });
  revalidateTask(task.id);
  return { ok: true };
}

/** Create a new tag (if absent) and connect it to the task. */
export async function createTagAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const name = normalizeTagName(String(formData.get("name") ?? ""));
  if (!taskId) return { error: "Missing task." };
  if (name.length === 0) return { error: "Tag name is required." };
  if (name.length > 50) return { error: "Tag name is too long." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // Upsert by unique name so we never create duplicates, then connect.
  const tag = await prisma.tag.upsert({
    where: { name },
    update: {},
    create: { name },
    select: { id: true },
  });
  await prisma.task.update({
    where: { id: task.id },
    data: { tags: { connect: { id: tag.id } } },
  });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Description (Tiptap) ----------------------------------------------------

/** Persist the Tiptap document JSON to Task.description. */
export async function setDescriptionAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const json = String(formData.get("description") ?? "");
  if (!taskId) return { error: "Missing task." };

  let doc: unknown;
  if (json.trim().length === 0) {
    doc = null;
  } else {
    try {
      doc = JSON.parse(json);
    } catch {
      return { error: "Could not save the description." };
    }
  }

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  await prisma.task.update({
    where: { id: task.id },
    // Prisma Json column: the JsonNull sentinel writes SQL NULL; a parsed object writes the doc.
    data: { description: doc === null ? Prisma.JsonNull : (doc as Prisma.InputJsonValue) },
  });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Subtasks ---------------------------------------------------------------

/**
 * Create a subtask: a Task with `parentId` set and `boardId` inherited from the parent.
 * Subtasks do NOT appear in the board grid (the grid filters parentId = null). The
 * creator is auto-assigned so a MEMBER can see the subtask they just made (per-row scope).
 */
export async function createSubtaskAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!taskId) return { error: "Missing task." };
  if (title.length === 0) return { error: "Subtask title is required." };
  if (title.length > 500) return { error: "Title is too long." };

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  const max = await prisma.task.aggregate({
    where: { parentId: task.id, archivedAt: null },
    _max: { order: true },
  });

  await prisma.task.create({
    data: {
      boardId: task.boardId,
      parentId: task.id,
      title,
      status: "TODO",
      order: appendOrder(max._max.order),
      createdById: actor.userId,
      assignees: { connect: { id: actor.userId } },
    },
  });
  revalidateTask(task.id);
  return { ok: true };
}

/** Toggle a subtask between TODO and DONE. Re-authorizes against the SUBTASK's own scope. */
export async function toggleSubtaskAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const subtaskId = String(formData.get("subtaskId") ?? "");
  if (!subtaskId) return { error: "Missing subtask." };

  // Subtasks are Tasks — re-authorize against the subtask's OWN visibility.
  const { task: subtask } = await findVisibleTask(subtaskId);
  if (!subtask) return { error: "Subtask not found." };

  const next: Status = subtask.status === "DONE" ? "TODO" : "DONE";
  await prisma.task.update({ where: { id: subtask.id }, data: { status: next } });
  // Revalidate the parent's detail page too.
  const parent = await prisma.task.findUnique({
    where: { id: subtask.id },
    select: { parentId: true },
  });
  revalidatePath(BOARD_PATH);
  if (parent?.parentId) revalidatePath(`/board/task/${parent.parentId}`);
  return { ok: true };
}

// --- Checklists -------------------------------------------------------------

export async function addChecklistAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const name = String(formData.get("name") ?? "").trim() || "Checklist";
  if (!taskId) return { error: "Missing task." };
  if (name.length > 120) return { error: "Checklist name is too long." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  const max = await prisma.checklist.aggregate({
    where: { taskId: task.id },
    _max: { order: true },
  });
  await prisma.checklist.create({
    data: { taskId: task.id, name, order: appendOrder(max._max.order) },
  });
  revalidateTask(task.id);
  return { ok: true };
}

export async function deleteChecklistAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const checklistId = String(formData.get("checklistId") ?? "");
  if (!taskId || !checklistId) return { error: "Missing checklist." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // The checklist must belong to a task the actor can see (re-authorized above).
  const cl = await prisma.checklist.findFirst({
    where: { id: checklistId, taskId: task.id },
    select: { id: true },
  });
  if (!cl) return { error: "Checklist not found." };

  await prisma.checklist.delete({ where: { id: cl.id } });
  revalidateTask(task.id);
  return { ok: true };
}

export async function addChecklistItemAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const checklistId = String(formData.get("checklistId") ?? "");
  const content = String(formData.get("content") ?? "").trim();
  if (!taskId || !checklistId) return { error: "Missing checklist." };
  if (content.length === 0) return { error: "Item text is required." };
  if (content.length > 500) return { error: "Item text is too long." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // Authorize the checklist belongs to this visible task.
  const cl = await prisma.checklist.findFirst({
    where: { id: checklistId, taskId: task.id },
    select: { id: true },
  });
  if (!cl) return { error: "Checklist not found." };

  const max = await prisma.checklistItem.aggregate({
    where: { checklistId: cl.id },
    _max: { order: true },
  });
  await prisma.checklistItem.create({
    data: { checklistId: cl.id, content, order: appendOrder(max._max.order) },
  });
  revalidateTask(task.id);
  return { ok: true };
}

export async function toggleChecklistItemAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!taskId || !itemId) return { error: "Missing item." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // The item must belong to a checklist on this visible task.
  const item = await prisma.checklistItem.findFirst({
    where: { id: itemId, checklist: { taskId: task.id } },
    select: { id: true, done: true },
  });
  if (!item) return { error: "Item not found." };

  await prisma.checklistItem.update({
    where: { id: item.id },
    data: { done: !item.done },
  });
  revalidateTask(task.id);
  return { ok: true };
}

export async function deleteChecklistItemAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!taskId || !itemId) return { error: "Missing item." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  const item = await prisma.checklistItem.findFirst({
    where: { id: itemId, checklist: { taskId: task.id } },
    select: { id: true },
  });
  if (!item) return { error: "Item not found." };

  await prisma.checklistItem.delete({ where: { id: item.id } });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Title ------------------------------------------------------------------

export async function renameTaskAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!taskId) return { error: "Missing task." };
  if (title.length === 0) return { error: "Title is required." };
  if (title.length > 500) return { error: "Title is too long." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  await prisma.task.update({ where: { id: task.id }, data: { title } });
  revalidateTask(task.id);
  return { ok: true };
}
