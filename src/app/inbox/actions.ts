"use server";

/**
 * Inbox server actions — fetch / mark-read. EVERY write and read is scoped to
 * `recipientId = actor.userId`: a user can only ever touch THEIR OWN notifications. We use
 * `updateMany`/`findMany` with the recipient in the WHERE so a guessed notification id from
 * another user is a silent no-op (never an error that leaks existence).
 */
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { loadNotifications, countUnread, type NotificationView } from "@/lib/notificationsData";

export interface InboxSnapshot {
  notifications: NotificationView[];
  unread: number;
}

/** Re-fetch the recipient's inbox (list + unread count). Called on open + on a live ping. */
export async function fetchInboxAction(): Promise<InboxSnapshot> {
  const actor = await requireActor();
  const [notifications, unread] = await Promise.all([
    loadNotifications(actor),
    countUnread(actor),
  ]);
  return { notifications, unread };
}

/** Mark ONE notification read. Scoped to the recipient — a foreign id is a no-op. */
export async function markReadAction(notificationId: string): Promise<InboxSnapshot> {
  const actor = await requireActor();
  if (notificationId) {
    await prisma.notification.updateMany({
      where: { id: notificationId, recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
  return fetchInboxAction();
}

/** Mark ALL of the recipient's unread notifications read. */
export async function markAllReadAction(): Promise<InboxSnapshot> {
  const actor = await requireActor();
  await prisma.notification.updateMany({
    where: { recipientId: actor.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return fetchInboxAction();
}
