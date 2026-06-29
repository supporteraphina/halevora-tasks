/**
 * Notification EMIT side. Server-only.
 *
 * Section 12 mints per-event notifications to a single RECIPIENT and live-delivers them over
 * the §11 SSE stream. This module is the one place mutations call to notify — it:
 *   1. writes the `Notification` rows (one per recipient/type, decided by the pure domain rules
 *      in src/domain/notifications.ts), then
 *   2. publishes a tiny, content-free `notification` ping on each recipient's OWN `user_<id>`
 *      channel so their inbox bell updates live (the SSE relay authorizes per recipient).
 *
 * SECURITY — the @mention-no-leak rule (documented decision, mirrors §11's chat rule):
 *   Being @mentioned grants a NOTIFICATION, never task/board ACCESS. We notify the mentioned
 *   user so they know they were named, and the notification links to the surface — but the link
 *   still respects row-level scope: opening it 404s under `loadTaskDetail` if the recipient is
 *   not otherwise a viewer (not an assignee, not CEO). The notification row itself is private to
 *   its recipient (every read filters `recipientId = actor`), and the live ping carries only ids
 *   (no task title/body on the wire). A mention thus never widens visibility — by construction.
 *
 * ADDITIVE + best-effort, exactly like recordActivity / publishEvent: a failure here NEVER
 * fails the mutation that triggered it. Notifications are a nicety; the app stays correct without.
 */
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { publishNotification } from "@/lib/realtime";
import {
  commentNotifyTargets,
  chatMentionTargets,
  assignedNotifyTargets,
  type NotifyTarget,
} from "@/domain/notifications";
import { extractMentionIdsFromDoc, extractMentionIds } from "@/domain/mentions";

/** All users — the mention candidate set + recipient existence check. Not task content. */
async function mentionCandidates(): Promise<
  { id: string; name: string; email: string }[]
> {
  return prisma.user.findMany({ select: { id: true, name: true, email: true } });
}

/**
 * Write the notification rows and live-ping each recipient. Shared tail of every emit path.
 * Each recipient's ping goes to THEIR `user_<id>` channel; the SSE relay re-checks recipient
 * identity, so a ping can only reach the user it is for.
 */
async function emit(
  targets: NotifyTarget[],
  ctx: {
    actorId: string;
    taskId?: string | null;
    boardId?: string | null;
    commentId?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  if (targets.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: targets.map((t) => ({
        recipientId: t.recipientId,
        type: t.type,
        actorId: ctx.actorId,
        taskId: ctx.taskId ?? null,
        boardId: ctx.boardId ?? null,
        commentId: ctx.commentId ?? null,
        data: ctx.data ? (ctx.data as Prisma.InputJsonValue) : Prisma.JsonNull,
      })),
    });
  } catch {
    // Best-effort: never surface a notification-write error to the mutation.
    return;
  }

  // Live ping per recipient on their OWN channel (ids only — the inbox re-fetches under scope).
  for (const t of targets) {
    await publishNotification(t.recipientId, ctx.boardId ?? undefined);
  }
}

/**
 * Notify on a NEW COMMENT. Resolves @mentions from the comment doc, loads the task's assignees
 * + creator, applies the pure recipient rules, and emits. `commentBody` is the stored Tiptap doc.
 */
export async function notifyOnComment(params: {
  actorId: string;
  taskId: string;
  boardId: string;
  commentId: string;
  commentBody: unknown;
  taskTitle: string;
}): Promise<void> {
  try {
    const [candidates, task] = await Promise.all([
      mentionCandidates(),
      prisma.task.findUnique({
        where: { id: params.taskId },
        select: {
          createdById: true,
          assignees: { select: { id: true } },
        },
      }),
    ]);
    if (!task) return;

    const mentionedIds = extractMentionIdsFromDoc(params.commentBody, candidates);
    const targets = commentNotifyTargets({
      actorId: params.actorId,
      mentionedIds,
      assigneeIds: task.assignees.map((a) => a.id),
      creatorId: task.createdById,
    });
    await emit(targets, {
      actorId: params.actorId,
      taskId: params.taskId,
      boardId: params.boardId,
      commentId: params.commentId,
      data: { taskTitle: params.taskTitle },
    });
  } catch {
    return;
  }
}

/**
 * Notify on a CHAT message. Resolves @mentions from the plain-text body and notifies the
 * mentioned users. Chat mentions name no task; the notification links to the board's chat.
 */
export async function notifyOnChatMessage(params: {
  actorId: string;
  boardId: string;
  body: string;
  boardName: string;
}): Promise<void> {
  try {
    const candidates = await mentionCandidates();
    const mentionedIds = extractMentionIds(params.body, candidates);
    const targets = chatMentionTargets(params.actorId, mentionedIds);
    await emit(targets, {
      actorId: params.actorId,
      boardId: params.boardId,
      data: { boardName: params.boardName },
    });
  } catch {
    return;
  }
}

/**
 * Notify on an ASSIGN. The newly-added assignee (unless self-assigned) gets an `assigned`
 * notification. They CAN see the task now (they're an assignee), so the link resolves for them.
 */
export async function notifyOnAssigned(params: {
  actorId: string;
  taskId: string;
  boardId: string;
  addedAssigneeId: string;
  taskTitle: string;
}): Promise<void> {
  try {
    const targets = assignedNotifyTargets(params.actorId, params.addedAssigneeId);
    await emit(targets, {
      actorId: params.actorId,
      taskId: params.taskId,
      boardId: params.boardId,
      data: { taskTitle: params.taskTitle },
    });
  } catch {
    return;
  }
}
