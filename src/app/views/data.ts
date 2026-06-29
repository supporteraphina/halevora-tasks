/**
 * Shared, SCOPED task loader for the list/calendar views (My Tasks, Today, Reviewed,
 * All-CEO, Add Tasks Quickly, the calendar, and saved views). Server-only.
 *
 * THE invariant: every read here composes `taskWhereForCurrentUser()` so a MEMBER only ever
 * sees tasks assigned to them (a CEO sees all). There is no bare `prisma.task.findMany` in a
 * view — they all go through `loadScopedTasks`, which resolves the scope fragment once and
 * ANDs it into the query. Overdue/Today are DERIVED at render in the actor's timezone; this
 * loader never buckets a date in server-UTC.
 */
import prisma from "@/lib/prisma";
import { taskWhereForCurrentUser } from "@/lib/scope";
import type { Status, Priority, Prisma } from "@prisma/client";

/** A task row projected for the list/calendar views (superset of domain `ViewTask`). */
export interface ViewTaskRow {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  dueAt: Date | null;
  startAt: Date | null;
  createdAt: Date;
  boardId: string;
  boardName: string;
  boardColor: string | null;
  assignees: { id: string; name: string }[];
  assigneeIds: string[];
  tagIds: string[];
  subtaskCount: number;
}

/** Extra task filters a view layers ON TOP of the scope fragment (never replacing it). */
export interface ScopedTaskQuery {
  /** Include REVIEWED tasks? Defaults to false (the board/My-Tasks views hide them). */
  includeReviewed?: boolean;
  /** When set, only tasks whose REVIEWED status matches (used by the Reviewed view). */
  onlyReviewed?: boolean;
  /** When true, only tasks with a non-null dueAt (used by the calendar). */
  hasDueOnly?: boolean;
}

const TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueAt: true,
  startAt: true,
  createdAt: true,
  boardId: true,
  board: { select: { name: true, color: true } },
  assignees: { select: { id: true, name: true } },
  tags: { select: { id: true } },
  _count: { select: { subtasks: true } },
} satisfies Prisma.TaskSelect;

/**
 * Load the current actor's visible, top-level, non-archived tasks across ALL boards,
 * scoped by `taskWhereForCurrentUser()`. The caller refines/sorts the result with the pure
 * `src/domain/views.ts` helpers. Reviewed handling is explicit, never implicit.
 */
export async function loadScopedTasks(
  query: ScopedTaskQuery = {},
): Promise<ViewTaskRow[]> {
  // The visibility fragment — resolved once, ANDed into the read. NEVER omitted.
  const scopeWhere = await taskWhereForCurrentUser();

  let statusWhere: Prisma.TaskWhereInput = {};
  if (query.onlyReviewed) {
    statusWhere = { status: "REVIEWED" };
  } else if (!query.includeReviewed) {
    statusWhere = { status: { not: "REVIEWED" } };
  }

  const rows = await prisma.task.findMany({
    where: {
      AND: [
        scopeWhere,
        {
          parentId: null,
          archivedAt: null,
          board: { archivedAt: null },
          ...statusWhere,
          ...(query.hasDueOnly ? { dueAt: { not: null } } : {}),
        },
      ],
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    select: TASK_SELECT,
  });

  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt,
    startAt: t.startAt,
    createdAt: t.createdAt,
    boardId: t.boardId,
    boardName: t.board.name,
    boardColor: t.board.color,
    assignees: t.assignees,
    assigneeIds: t.assignees.map((a) => a.id),
    tagIds: t.tags.map((tag) => tag.id),
    subtaskCount: t._count.subtasks,
  }));
}

/** Facet option lists for the quick-filter controls (assignees + tags the actor can pick). */
export interface FilterOptions {
  users: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

/**
 * Picker options for the filter controls. Users + tags are reference data (any user may be
 * an assignee; tags are global), so these lists are not row-scoped — they only populate
 * dropdowns. The task READS remain scoped, which is what protects task content.
 */
export async function loadFilterOptions(): Promise<FilterOptions> {
  const [users, tags] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { users, tags };
}

/** Boards the actor can target for fast-entry create (reference data; create is authorized). */
export async function loadBoardOptions(): Promise<
  { id: string; name: string; color: string | null }[]
> {
  return prisma.board.findMany({
    where: { archivedAt: null },
    orderBy: { order: "asc" },
    select: { id: true, name: true, color: true },
  });
}
