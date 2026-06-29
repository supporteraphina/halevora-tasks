/**
 * Task detail data loader. Server-only.
 *
 * Loads ONE task the current actor may see, plus everything the detail panel renders:
 * assignees, tags, subtasks (each scoped to its OWN assignees), checklists + items, and
 * the Tiptap `description`. EVERY task read composes `taskWhereForCurrentUser()` so a
 * MEMBER only ever sees tasks assigned to them (CEO sees all). A card id from the client
 * is untrusted — a foreign/invisible id returns null (the caller renders a 404, never
 * leaking existence).
 *
 * Overdue is NOT loaded — derived at render with `isOverdue` / `badgeFor`.
 */
import prisma from "@/lib/prisma";
import { taskWhereForCurrentUser } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import { currentActor } from "@/lib/scope";
import { storageEnabled } from "@/lib/storage";
import type { Status, Priority, CustomFieldType } from "@prisma/client";

export interface DetailAssignee {
  id: string;
  name: string;
}

export interface DetailTag {
  id: string;
  name: string;
  color: string | null;
}

export interface DetailSubtask {
  id: string;
  title: string;
  status: Status;
  dueAt: Date | null;
}

export interface DetailChecklistItem {
  id: string;
  content: string;
  done: boolean;
  order: number;
}

export interface DetailChecklist {
  id: string;
  name: string;
  order: number;
  items: DetailChecklistItem[];
}

/** A board's custom field plus this task's value for it. `config`/`value` are raw JSON. */
export interface DetailCustomField {
  fieldId: string;
  name: string;
  type: CustomFieldType;
  config: unknown;
  order: number;
  value: unknown; // null when unset
}

export interface DetailAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
  uploadedBy: string | null;
}

export interface DetailComment {
  id: string;
  body: unknown; // Tiptap JSON document
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
}

export interface DetailActivity {
  id: string;
  type: string;
  data: unknown;
  actorName: string | null;
  createdAt: Date;
}

export interface TaskDetail {
  id: string;
  boardId: string;
  boardName: string;
  title: string;
  description: unknown; // Tiptap JSON document (or null)
  status: Status;
  priority: Priority;
  startAt: Date | null;
  dueAt: Date | null;
  timeEstimate: number | null;
  assignees: DetailAssignee[];
  tags: DetailTag[];
  subtasks: DetailSubtask[];
  checklists: DetailChecklist[];
  customFields: DetailCustomField[];
  attachments: DetailAttachment[];
  attachmentsEnabled: boolean;
  comments: DetailComment[];
  activity: DetailActivity[];
}

/** Everyone in the workspace — for the assignee + tag pickers. Names are not task content. */
export interface PickerData {
  users: { id: string; name: string; email: string }[];
  tags: DetailTag[];
}

/**
 * Load the task the current actor may see, by id. Returns null when the task does not
 * exist OR the actor may not see it (treated the same — never leak existence).
 */
export async function loadTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const scopeWhere = await taskWhereForCurrentUser();
  const actor = await currentActor();
  if (!actor) return null;

  // SCOPED read: visibility fragment AND this id, not archived.
  const task = await prisma.task.findFirst({
    where: { AND: [scopeWhere, { id: taskId, archivedAt: null }] },
    select: {
      id: true,
      boardId: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      startAt: true,
      dueAt: true,
      timeEstimate: true,
      board: { select: { name: true } },
      assignees: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      tags: {
        select: { id: true, name: true, color: true },
        orderBy: { name: "asc" },
      },
      checklists: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          order: true,
          items: {
            orderBy: { order: "asc" },
            select: { id: true, content: true, done: true, order: true },
          },
        },
      },
      customFieldValues: {
        select: { fieldId: true, value: true },
      },
      attachments: {
        where: { commentId: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          body: true,
          authorId: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      },
      activity: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          data: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      },
    },
  });

  if (!task) return null;

  // The board's custom field definitions (a field belongs to the board, not the task).
  // Loaded only AFTER the task passed the scope check above, so this never leaks a
  // hidden task's board: we already proved the actor may see this task.
  const fields = await prisma.customField.findMany({
    where: { boardId: task.boardId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, type: true, config: true, order: true },
  });
  const valueByField = new Map(
    task.customFieldValues.map((v) => [v.fieldId, v.value]),
  );

  // Subtasks are Tasks too — scope them independently to the actor's OWN visibility,
  // composing the scope fragment with parentId = this task. A member sees a subtask only
  // when assigned to that subtask (per-row), not by virtue of seeing the parent.
  const subtasks = await prisma.task.findMany({
    where: {
      AND: [
        taskScopeWhere(actor),
        { parentId: task.id, archivedAt: null },
      ],
    },
    orderBy: { order: "asc" },
    select: { id: true, title: true, status: true, dueAt: true },
  });

  return {
    id: task.id,
    boardId: task.boardId,
    boardName: task.board.name,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority,
    startAt: task.startAt,
    dueAt: task.dueAt,
    timeEstimate: task.timeEstimate,
    assignees: task.assignees,
    tags: task.tags,
    subtasks,
    checklists: task.checklists.map((c) => ({
      id: c.id,
      name: c.name,
      order: c.order,
      items: c.items,
    })),
    customFields: fields.map((f) => ({
      fieldId: f.id,
      name: f.name,
      type: f.type,
      config: f.config ?? null,
      order: f.order,
      value: valueByField.get(f.id) ?? null,
    })),
    attachments: task.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: a.createdAt,
      uploadedBy: a.uploadedBy?.name ?? null,
    })),
    attachmentsEnabled: storageEnabled(),
    comments: task.comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorId: c.authorId,
      authorName: c.author?.name ?? null,
      createdAt: c.createdAt,
    })),
    activity: task.activity.map((a) => ({
      id: a.id,
      type: a.type,
      data: a.data ?? null,
      actorName: a.actor?.name ?? null,
      createdAt: a.createdAt,
    })),
  };
}

/** Workspace users + all tags, for the assignee/tag pickers. Not row-scoped task content. */
export async function loadPickerData(): Promise<PickerData> {
  const [users, tags] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
  ]);
  return { users, tags };
}
