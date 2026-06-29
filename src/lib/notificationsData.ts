/**
 * Notification READ side. Server-only.
 *
 * Every read is filtered to `recipientId = actor.userId` — a notification is private to its
 * recipient (the security boundary; mirrors the row-level task scope, applied here on the
 * recipient column). A user can only ever load, count, or mark-read THEIR OWN notifications.
 *
 * The display snippet (`data.taskTitle` / `data.boardName`) was captured at emit time, so the
 * inbox renders without re-reading the linked task — which means a `mentioned` notification can
 * show "you were mentioned" even for a task the recipient can't open. Clicking through still
 * routes through `loadTaskDetail`, which 404s under scope (the documented @mention-no-leak rule):
 * the link is shown, the task itself stays gated. The snippet is intentionally minimal (title
 * only), captured from a surface the actor could already see.
 */
import prisma from "@/lib/prisma";
import type { SessionActor } from "@/lib/scope";
import type { NotificationType } from "@/domain/notifications";

export interface NotificationView {
  id: string;
  type: NotificationType;
  taskId: string | null;
  boardId: string | null;
  actorName: string | null;
  taskTitle: string | null;
  boardName: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function viewOf(n: {
  id: string;
  type: NotificationType;
  taskId: string | null;
  boardId: string | null;
  readAt: Date | null;
  createdAt: Date;
  actor: { name: string } | null;
  data: unknown;
}): NotificationView {
  const data = (n.data ?? {}) as Record<string, unknown>;
  return {
    id: n.id,
    type: n.type,
    taskId: n.taskId,
    boardId: n.boardId,
    actorName: n.actor?.name ?? null,
    taskTitle: typeof data.taskTitle === "string" ? data.taskTitle : null,
    boardName: typeof data.boardName === "string" ? data.boardName : null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

/** The recipient's recent notifications, newest-first. Always scoped to recipientId = actor. */
export async function loadNotifications(
  actor: SessionActor,
  limit = 30,
): Promise<NotificationView[]> {
  const rows = await prisma.notification.findMany({
    where: { recipientId: actor.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      taskId: true,
      boardId: true,
      readAt: true,
      createdAt: true,
      data: true,
      actor: { select: { name: true } },
    },
  });
  return rows.map(viewOf);
}

/** Count the recipient's unread notifications (drives the bell badge). Scoped to the actor. */
export async function countUnread(actor: SessionActor): Promise<number> {
  return prisma.notification.count({
    where: { recipientId: actor.userId, readAt: null },
  });
}
