/**
 * Recurrence engine — server-only spawn logic shared by the inline ON_STATUS_CHANGE path
 * (both status actions) and the ON_SCHEDULE scheduled worker.
 *
 * When a recurring task recurs we spawn a FRESH COPY reset to `statusOnRecur` (default
 * TODO — legacy ClickUp behavior, NEVER a forced "New" status) carrying title / board /
 * description / priority / time-estimate / assignees / tags / custom-field values, and we
 * move the recurrence rule onto the copy. The OLD instance LEAVES THE BOARD (archived;
 * never hard-deleted) and no longer recurs. Start/due advance by the cadence when
 * "sync recurrence to due date" is on. Both events are written to the append-only
 * ActivityLog.
 *
 * IDEMPOTENCY: the whole spawn runs in one transaction that DETACHES the rule from the old
 * task (it now lives on the new copy). A second trigger on the old task therefore finds no
 * rule and does nothing — re-marking the trigger status never double-spawns.
 *
 * The date math is the pure `src/domain/recurrence.ts` (UTC-stored, computed in the actor's
 * zone). This module is the DB glue only.
 */
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { advanceDate, nextOccurrence } from "@/domain/recurrence";

/** A clear, sessionless actor for the scheduled worker's writes (no per-user scope). */
export const SYSTEM_ACTOR_ID: string | null = null;

/**
 * Spawn the next instance of a recurring task and retire the old one. Runs in a single
 * transaction. `timeZone` is the zone the cadence is computed in (the triggering actor's,
 * or the task creator's for the worker). `actorId` is who to attribute the activity to
 * (null for the system worker). Returns the new task id, or null if the task has no
 * recurrence rule (already consumed / never had one) — making the call idempotent.
 *
 * NOTE: this performs NO authorization. Callers MUST re-authorize the source task first
 * (the inline path does via `findVisibleTask`; the worker runs as a trusted system actor).
 */
export async function spawnRecurrence(params: {
  taskId: string;
  timeZone: string;
  actorId: string | null;
}): Promise<{ newTaskId: string } | null> {
  const { taskId, timeZone, actorId } = params;

  return prisma.$transaction(async (tx) => {
    // Load the source with everything we carry forward. The rule presence is the idempotency
    // hinge: if it's gone (a prior trigger already consumed it), we no-op.
    const source = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        boardId: true,
        parentId: true,
        title: true,
        description: true,
        priority: true,
        timeEstimate: true,
        startAt: true,
        dueAt: true,
        order: true,
        assignees: { select: { id: true } },
        tags: { select: { id: true } },
        customFieldValues: {
          select: {
            fieldId: true,
            value: true,
            people: { select: { id: true } },
          },
        },
        recurrence: true,
      },
    });
    if (!source || !source.recurrence) return null;

    const rule = source.recurrence;
    const now = new Date();

    // Advance start/due by ONE cadence step when syncing to the due date. Anchor each on
    // its own current value so the gap between start and due is preserved.
    const spec = { cadence: rule.cadence, interval: rule.interval };
    let newStartAt = source.startAt;
    let newDueAt = source.dueAt;
    if (rule.syncToDueDate) {
      if (source.startAt) newStartAt = advanceDate(source.startAt, spec, timeZone);
      if (source.dueAt) newDueAt = advanceDate(source.dueAt, spec, timeZone);
    }

    // The new copy sits at the end of its column so it does not displace siblings.
    const max = await tx.task.aggregate({
      where: { boardId: source.boardId, parentId: null, archivedAt: null },
      _max: { order: true },
    });
    const nextOrder = (max._max.order ?? 0) + 1;

    // Compute the new rule's nextRunAt for the schedule trigger: the first occurrence
    // strictly after now, anchored on the (advanced) due/start date or the prior nextRunAt.
    const anchor = newDueAt ?? newStartAt ?? rule.nextRunAt ?? now;
    const newNextRunAt =
      rule.trigger === "ON_SCHEDULE"
        ? nextOccurrence(anchor, now, spec, timeZone)
        : null;

    // Create the fresh copy reset to statusOnRecur (default TODO), carrying the fields and
    // MOVING the recurrence rule onto it (1:1 relation — delete on old, create on new).
    const created = await tx.task.create({
      data: {
        boardId: source.boardId,
        parentId: source.parentId,
        title: source.title,
        description:
          source.description == null
            ? Prisma.JsonNull
            : (source.description as Prisma.InputJsonValue),
        status: rule.statusOnRecur, // <- the configurable reset; default TODO
        priority: source.priority,
        timeEstimate: source.timeEstimate,
        startAt: newStartAt,
        dueAt: newDueAt,
        order: nextOrder,
        createdById: actorId,
        assignees: { connect: source.assignees.map((a) => ({ id: a.id })) },
        tags: { connect: source.tags.map((t) => ({ id: t.id })) },
        recurrence: {
          create: {
            cadence: rule.cadence,
            interval: rule.interval,
            trigger: rule.trigger,
            triggerStatus: rule.triggerStatus,
            statusOnRecur: rule.statusOnRecur,
            syncToDueDate: rule.syncToDueDate,
            byWeekday: rule.byWeekday,
            byMonthday: rule.byMonthday,
            config:
              rule.config == null
                ? Prisma.JsonNull
                : (rule.config as Prisma.InputJsonValue),
            nextRunAt: newNextRunAt,
          },
        },
      },
      select: { id: true },
    });

    // Carry custom-field values onto the copy (value JSON + PEOPLE relation).
    for (const v of source.customFieldValues) {
      await tx.customFieldValue.create({
        data: {
          taskId: created.id,
          fieldId: v.fieldId,
          value:
            v.value == null
              ? Prisma.JsonNull
              : (v.value as Prisma.InputJsonValue),
          people: { connect: v.people.map((p) => ({ id: p.id })) },
        },
      });
    }

    // Retire the OLD instance: it leaves the active board (archived; never hard-deleted)
    // and its recurrence rule is removed so it can never recur again (idempotency).
    await tx.recurrenceRule.delete({ where: { taskId: source.id } });
    await tx.task.update({
      where: { id: source.id },
      data: { archivedAt: now },
    });

    // Append-only activity on both instances. Best-effort within the txn; a logging row
    // failure should not be the reason a recur fails, but inside a txn we let it ride.
    await tx.activityLog.create({
      data: {
        taskId: source.id,
        boardId: source.boardId,
        actorId,
        type: "recurrence_spawned",
        data: { cadence: rule.cadence, newTaskId: created.id },
      },
    });
    await tx.activityLog.create({
      data: {
        taskId: created.id,
        boardId: source.boardId,
        actorId,
        type: "recurrence_closed",
        data: { fromTaskId: source.id },
      },
    });

    return { newTaskId: created.id };
  });
}
