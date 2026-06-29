/**
 * Notification domain logic. Pure, framework-free.
 *
 * Section 12 emits per-event notifications to a single RECIPIENT (unlike §11's board-broadcast
 * realtime events). This module owns:
 *   - the notification `type` union (mirror of the Prisma enum-as-string),
 *   - the pure "who should be notified" rules for each event, with de-duplication and the
 *     never-notify-yourself rule.
 *
 * The SERVER (src/lib/notifications.ts) supplies the live facts (which users were mentioned,
 * who is assigned, who created the task) and writes the rows + live pings. The rules below are
 * the single source of truth for WHOM, so they are unit-tested exhaustively (a wrong recipient
 * set is both a noise bug and, paired with the visibility rule, a potential leak vector).
 */

/** The kinds of notification we mint in v1. Mirror of the Prisma `NotificationType`. */
export type NotificationType = "assigned" | "mentioned" | "commented";

export const NOTIFICATION_TYPES: NotificationType[] = [
  "assigned",
  "mentioned",
  "commented",
];

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === "string" && (NOTIFICATION_TYPES as string[]).includes(v);
}

/**
 * Who gets notified when an actor posts a COMMENT on a task. The rule:
 *   - everyone @mentioned in the comment body gets a `mentioned` notification, AND
 *   - the task's other stakeholders (assignees + creator) get a `commented` notification,
 *     so people following a task they own/work hear about new discussion.
 * The actor is NEVER notified about their own action. A user who is BOTH mentioned and a
 * stakeholder gets the `mentioned` notification only (the stronger, more specific signal) —
 * we de-dupe so nobody gets two pings for one comment.
 *
 * Returns a per-recipient decision: { recipientId, type }. Pure — the caller resolves the
 * input id sets from the DB and writes the rows.
 */
export interface CommentNotifyInput {
  actorId: string;
  /** Distinct user ids resolved from @mentions in the comment. */
  mentionedIds: string[];
  /** The task's current assignees. */
  assigneeIds: string[];
  /** The task's creator, if known. */
  creatorId?: string | null;
}

export interface NotifyTarget {
  recipientId: string;
  type: NotificationType;
}

export function commentNotifyTargets(input: CommentNotifyInput): NotifyTarget[] {
  const out = new Map<string, NotificationType>();

  // Stakeholders first (weaker signal), so a later mention overwrites to the stronger type.
  const stakeholders = new Set<string>(input.assigneeIds);
  if (input.creatorId) stakeholders.add(input.creatorId);
  for (const id of stakeholders) {
    if (id === input.actorId) continue;
    out.set(id, "commented");
  }

  // Mentions override (stronger, more specific). Never notify the actor about their own.
  for (const id of input.mentionedIds) {
    if (id === input.actorId) continue;
    out.set(id, "mentioned");
  }

  return [...out].map(([recipientId, type]) => ({ recipientId, type }));
}

/**
 * Who gets notified when an actor @mentions users in a CHAT message: just the mentioned
 * users (chat has no per-message assignee/creator notion). The actor is never self-notified.
 */
export function chatMentionTargets(
  actorId: string,
  mentionedIds: string[],
): NotifyTarget[] {
  const out: NotifyTarget[] = [];
  const seen = new Set<string>();
  for (const id of mentionedIds) {
    if (id === actorId || seen.has(id)) continue;
    seen.add(id);
    out.push({ recipientId: id, type: "mentioned" });
  }
  return out;
}

/**
 * Who gets notified when an actor ADDS an assignee to a task: the newly-added assignee gets
 * an `assigned` notification — unless they added themselves (you don't notify yourself for
 * self-assigning). Returns at most one target.
 */
export function assignedNotifyTargets(
  actorId: string,
  addedAssigneeId: string,
): NotifyTarget[] {
  if (addedAssigneeId === actorId) return [];
  return [{ recipientId: addedAssigneeId, type: "assigned" }];
}
