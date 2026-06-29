/**
 * Board view data loader. Server-only.
 *
 * Loads the workspace -> first project -> its boards, and for each board its SCOPED
 * top-level cards. EVERY task read composes `taskWhereForCurrentUser()` so a MEMBER only
 * ever sees tasks assigned to them (CEO sees all). REVIEWED tasks leave the board grid.
 * Overdue is NOT loaded — it is derived at render with `isOverdue(task, new Date())`.
 */
import prisma from "@/lib/prisma";
import { taskWhereForCurrentUser } from "@/lib/scope";
import { openBlockerCount } from "@/domain/dependencies";
import type { Status, Priority } from "@prisma/client";

export interface BoardCard {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  dueAt: Date | null;
  startAt: Date | null;
  order: number;
  boardId: string;
  assignees: { id: string; name: string }[];
  subtaskCount: number;
  // Count of OPEN blockers (incoming dependency edges whose blocker is not closed). Drives
  // the small "blocked" indicator on the card. Counted over ALL edges, not scoped, so the
  // indicator is honest even when a member can't see the blocking task.
  openBlockerCount: number;
}

export interface BoardColumn {
  id: string;
  name: string;
  color: string | null;
  order: number;
  cards: BoardCard[];
}

export interface BoardData {
  workspaceName: string;
  projectName: string | null;
  projects: { id: string; name: string }[];
  columns: BoardColumn[];
}

/** The current actor's view of the board: boards-as-columns with scoped cards. */
export async function loadBoard(): Promise<BoardData> {
  // Resolve the visibility fragment and the workspace tree in PARALLEL. Each is one DB
  // round-trip; with the database in another region, back-to-back awaits are the main cost.
  const [scopeWhere, workspace] = await Promise.all([
    taskWhereForCurrentUser(),
    prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
      include: {
        projects: {
          orderBy: { order: "asc" },
          include: {
            boards: {
              where: { archivedAt: null },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    }),
  ]);

  if (!workspace) {
    return {
      workspaceName: "Halevora",
      projectName: null,
      projects: [],
      columns: [],
    };
  }

  const project = workspace.projects[0] ?? null;
  const boards = project?.boards ?? [];

  // ONE scoped query for every board's cards (was N sequential queries — one per board).
  // The scope fragment is composed in, so a MEMBER still only sees their assigned cards.
  const allTasks = boards.length
    ? await prisma.task.findMany({
        where: {
          AND: [
            scopeWhere,
            {
              boardId: { in: boards.map((b) => b.id) },
              parentId: null,
              archivedAt: null,
              status: { not: "REVIEWED" },
            },
          ],
        },
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueAt: true,
          startAt: true,
          order: true,
          boardId: true,
          assignees: { select: { id: true, name: true } },
          _count: {
            // Subtasks are Tasks too; the card shows only the count (detail panel lists them, §4).
            select: { subtasks: true },
          },
          // Incoming dependency edges (this card is `blocked`) + the blocker's status, so we
          // can count OPEN blockers for the "blocked" indicator.
          blockedBy: { select: { blocker: { select: { status: true } } } },
        },
      })
    : [];

  // Group the flat result back into columns by board (preserving the per-board order,
  // since the global `order` sort keeps each board's cards ascending).
  type TaskRow = (typeof allTasks)[number];
  const byBoard = new Map<string, TaskRow[]>();
  for (const t of allTasks) {
    const arr = byBoard.get(t.boardId);
    if (arr) arr.push(t);
    else byBoard.set(t.boardId, [t]);
  }

  const columns: BoardColumn[] = boards.map((board) => ({
    id: board.id,
    name: board.name,
    color: board.color,
    order: board.order,
    cards: (byBoard.get(board.id) ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt,
      startAt: t.startAt,
      order: t.order,
      boardId: t.boardId,
      assignees: t.assignees,
      subtaskCount: t._count.subtasks,
      openBlockerCount: openBlockerCount(
        t.blockedBy.map((b) => ({ status: b.blocker.status })),
      ),
    })),
  }));

  return {
    workspaceName: workspace.name,
    projectName: project?.name ?? null,
    projects: workspace.projects.map((p) => ({ id: p.id, name: p.name })),
    columns,
  };
}
