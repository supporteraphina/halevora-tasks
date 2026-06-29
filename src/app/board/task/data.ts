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
import type { Status, Priority } from "@prisma/client";

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
    },
  });

  if (!task) return null;

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
