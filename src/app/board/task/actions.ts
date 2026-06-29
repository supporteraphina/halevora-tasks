"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireActor, requireRole } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import { STATUSES, type Status } from "@/domain/status";
import { PRIORITIES, type Priority } from "@/domain/priority";
import { appendOrder } from "@/domain/ordering";
import {
  parseDateInput,
  quickChoiceDate,
  QUICK_CHOICES,
  formatInZone,
} from "@/domain/dates";
import { parseTimeEstimate, normalizeTagName } from "@/domain/taskDetail";
import { isCustomFieldKind, parseFieldValue } from "@/domain/customFields";
import { recordActivity } from "@/lib/activity";

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
    select: {
      id: true,
      boardId: true,
      status: true,
      priority: true,
      startAt: true,
      dueAt: true,
    },
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

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  if (task.status !== status) {
    await prisma.task.update({ where: { id: task.id }, data: { status } });
    await recordActivity({
      taskId: task.id,
      boardId: task.boardId,
      actorId: actor.userId,
      type: "status_changed",
      data: { from: task.status, to: status },
    });
  }
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

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  if (task.priority !== priority) {
    await prisma.task.update({ where: { id: task.id }, data: { priority } });
    await recordActivity({
      taskId: task.id,
      boardId: task.boardId,
      actorId: actor.userId,
      type: "priority_changed",
      data: { from: task.priority, to: priority },
    });
  }
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

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // The picked user must exist (any signed-in user may assign to anyone).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true },
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
  await recordActivity({
    taskId: task.id,
    boardId: task.boardId,
    actorId: actor.userId,
    type: op === "add" ? "assignee_added" : "assignee_removed",
    data: { name: user.name },
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
  await recordActivity({
    taskId: task.id,
    boardId: task.boardId,
    actorId: actor.userId,
    type: field === "start" ? "start_changed" : "due_changed",
    data: { to: value ? formatInZone(value, actor.timezone) : null },
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

// --- Custom field values ----------------------------------------------------

/**
 * Set (or clear) a custom field's value on a task. Re-authorizes the task via
 * `findVisibleTask`, then verifies the field belongs to THIS task's board (a field id
 * from the client is untrusted — this blocks writing a value for a foreign board's field,
 * the IDOR pattern). Parsing/validation is the pure `parseFieldValue`; PEOPLE also syncs
 * the `people` relation (ids stay in `value` too for portability).
 */
export async function setCustomFieldValueAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const fieldId = String(formData.get("fieldId") ?? "");
  const raw = String(formData.get("value") ?? "");
  if (!taskId) return { error: "Missing task." };
  if (!fieldId) return { error: "Missing field." };

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // The field must belong to this visible task's board (row-ownership check).
  const field = await prisma.customField.findFirst({
    where: { id: fieldId, boardId: task.boardId },
    select: { id: true, name: true, type: true, config: true },
  });
  if (!field) return { error: "Field not found." };
  if (!isCustomFieldKind(field.type)) return { error: "Unsupported field type." };

  const parsed = parseFieldValue(field.type, field.config, raw);
  if (!parsed.ok) return { error: parsed.error };

  // For PEOPLE, only connect ids that are real users (any user may be referenced).
  let peopleIds: string[] = [];
  if (field.type === "PEOPLE" && Array.isArray(parsed.value)) {
    const ids = parsed.value as string[];
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    peopleIds = users.map((u) => u.id);
  }

  const valueJson =
    parsed.value === null
      ? Prisma.JsonNull
      : (parsed.value as Prisma.InputJsonValue);

  await prisma.customFieldValue.upsert({
    where: { taskId_fieldId: { taskId: task.id, fieldId: field.id } },
    create: {
      taskId: task.id,
      fieldId: field.id,
      value: valueJson,
      ...(field.type === "PEOPLE"
        ? { people: { connect: peopleIds.map((id) => ({ id })) } }
        : {}),
    },
    update: {
      value: valueJson,
      ...(field.type === "PEOPLE"
        ? { people: { set: peopleIds.map((id) => ({ id })) } }
        : {}),
    },
  });

  await recordActivity({
    taskId: task.id,
    boardId: task.boardId,
    actorId: actor.userId,
    type: "custom_field_set",
    data: { field: field.name },
  });
  revalidateTask(task.id);
  return { ok: true };
}

/**
 * Define a new custom field on a board. CEO-only (the CEO owns the board's schema).
 * Re-authorizes the actor's role and the task it was launched from. Field types are the
 * nine v1 kinds; DROPDOWN/LABELS optionally seed labels from a newline list.
 */
export async function createCustomFieldAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const optionsRaw = String(formData.get("options") ?? "");
  if (!taskId) return { error: "Missing task." };
  if (name.length === 0) return { error: "Field name is required." };
  if (name.length > 80) return { error: "Field name is too long." };
  if (!isCustomFieldKind(type)) return { error: "Unsupported field type." };

  // CEO-only: define the board's schema. Throws FORBIDDEN for a member.
  await requireRole("CEO");
  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  let config: Prisma.InputJsonValue | undefined;
  if (type === "DROPDOWN" || type === "LABELS") {
    const options = optionsRaw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((label, i) => ({ id: `opt${i + 1}`, label }));
    if (options.length === 0) return { error: "Add at least one option." };
    config = { options };
  } else if (type === "RATING") {
    config = { max: 5 };
  } else if (type === "SLIDER") {
    config = { min: 0, max: 100 };
  }

  const max = await prisma.customField.aggregate({
    where: { boardId: task.boardId },
    _max: { order: true },
  });
  await prisma.customField.create({
    data: {
      boardId: task.boardId,
      name,
      type,
      config,
      order: appendOrder(max._max.order),
    },
  });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Comments ---------------------------------------------------------------

/** Cheap server-side guard that a parsed value is a non-empty Tiptap doc. */
function isNonEmptyTiptapDoc(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const doc = v as { type?: unknown; content?: unknown };
  if (doc.type !== "doc") return false;
  if (!Array.isArray(doc.content) || doc.content.length === 0) return false;
  // Reject a doc that is only empty paragraphs (no text anywhere).
  const json = JSON.stringify(doc);
  return /"text"\s*:\s*"[^"]/.test(json);
}

/** Post a comment (Tiptap doc) on a visible task. Author = current actor. */
export async function createCommentAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const json = String(formData.get("body") ?? "");
  if (!taskId) return { error: "Missing task." };

  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { error: "Could not read the comment." };
  }
  if (!isNonEmptyTiptapDoc(doc)) return { error: "Write something first." };

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  await prisma.comment.create({
    data: {
      taskId: task.id,
      authorId: actor.userId,
      body: doc as Prisma.InputJsonValue,
    },
  });
  await recordActivity({
    taskId: task.id,
    boardId: task.boardId,
    actorId: actor.userId,
    type: "comment_created",
  });
  revalidateTask(task.id);
  return { ok: true };
}

/** Edit a comment. Gated by visible-task re-auth AND author ownership. */
export async function editCommentAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const commentId = String(formData.get("commentId") ?? "");
  const json = String(formData.get("body") ?? "");
  if (!taskId || !commentId) return { error: "Missing comment." };

  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { error: "Could not read the comment." };
  }
  if (!isNonEmptyTiptapDoc(doc)) return { error: "Write something first." };

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  // The comment must belong to this visible task AND be authored by the actor.
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, taskId: task.id, authorId: actor.userId },
    select: { id: true },
  });
  if (!comment) return { error: "Comment not found." };

  await prisma.comment.update({
    where: { id: comment.id },
    data: { body: doc as Prisma.InputJsonValue },
  });
  revalidateTask(task.id);
  return { ok: true };
}

/** Delete a comment. Gated by visible-task re-auth AND author ownership. */
export async function deleteCommentAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const commentId = String(formData.get("commentId") ?? "");
  if (!taskId || !commentId) return { error: "Missing comment." };

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, taskId: task.id, authorId: actor.userId },
    select: { id: true },
  });
  if (!comment) return { error: "Comment not found." };

  await prisma.comment.delete({ where: { id: comment.id } });
  revalidateTask(task.id);
  return { ok: true };
}

// --- Attachments ------------------------------------------------------------

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Upload a file to a visible task. Re-authorizes the task, then (if storage is enabled)
 * pushes bytes to Supabase Storage under a per-task object key and persists the
 * `Attachment` row. Degrades gracefully when the service key is absent: returns a clear
 * disabled message instead of throwing. The storage key never reaches the client.
 */
export async function uploadAttachmentAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const file = formData.get("file");
  if (!taskId) return { error: "Missing task." };
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is too large (max 25 MB)." };

  const { storageEnabled, objectKeyFor, uploadObject } = await import("@/lib/storage");
  if (!storageEnabled()) {
    return { error: "Attachments need SUPABASE_SERVICE_ROLE_KEY in .env" };
  }

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  const key = objectKeyFor(task.id, file.name);
  const bytes = await file.arrayBuffer();
  const up = await uploadObject(key, bytes, file.type);
  if (!up.ok) return { error: up.error };

  await prisma.attachment.create({
    data: {
      taskId: task.id,
      filename: file.name,
      path: key,
      mimeType: file.type || null,
      size: file.size,
      uploadedById: actor.userId,
    },
  });
  await recordActivity({
    taskId: task.id,
    boardId: task.boardId,
    actorId: actor.userId,
    type: "attachment_added",
    data: { filename: file.name },
  });
  revalidateTask(task.id);
  return { ok: true };
}

/**
 * Return a short-lived signed download URL for an attachment on a visible task.
 * Re-authorizes the task and verifies the attachment belongs to it (row-ownership).
 */
export async function getAttachmentUrlAction(
  taskId: string,
  attachmentId: string,
): Promise<{ url?: string; error?: string }> {
  if (!taskId || !attachmentId) return { error: "Missing attachment." };

  const { task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, taskId: task.id },
    select: { path: true },
  });
  if (!attachment) return { error: "Attachment not found." };

  const { signedUrlFor } = await import("@/lib/storage");
  const signed = await signedUrlFor(attachment.path);
  if (!signed.ok) return { error: signed.error };
  return { url: signed.value };
}

/** Delete an attachment on a visible task (storage object + DB row). Row-ownership checked. */
export async function deleteAttachmentAction(
  _prev: DetailActionState,
  formData: FormData,
): Promise<DetailActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const attachmentId = String(formData.get("attachmentId") ?? "");
  if (!taskId || !attachmentId) return { error: "Missing attachment." };

  const { actor, task } = await findVisibleTask(taskId);
  if (!task) return { error: "Task not found." };

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, taskId: task.id },
    select: { id: true, path: true, filename: true },
  });
  if (!attachment) return { error: "Attachment not found." };

  const { deleteObject } = await import("@/lib/storage");
  await deleteObject(attachment.path); // best-effort; remove the DB row regardless
  await prisma.attachment.delete({ where: { id: attachment.id } });
  await recordActivity({
    taskId: task.id,
    boardId: task.boardId,
    actorId: actor.userId,
    type: "attachment_removed",
    data: { filename: attachment.filename },
  });
  revalidateTask(task.id);
  return { ok: true };
}
