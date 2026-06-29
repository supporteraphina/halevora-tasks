/**
 * Scheduled recurrence worker — the ON_SCHEDULE path. Reusable + unit-testable single-pass
 * processing that finds due `RecurrenceRule`s (by `nextRunAt <= now`), spawns the next
 * instance, and advances the rule's `nextRunAt` via the pure step. §8 (automation) shares
 * this infra for time-based triggers — keep `runScheduledRecurrences` importable and small.
 *
 * SECURITY: this runs WITHOUT a session. It is a trusted SYSTEM actor — it deliberately
 * applies NO per-user scope to its writes (it processes every due rule across all users).
 * Activity is attributed to a null (system) actor. The clock basis is UTC (`new Date()`),
 * and each occurrence is processed at most once per tick because `spawnRecurrence` consumes
 * the source rule and the freshly-spawned copy's `nextRunAt` is computed strictly in the
 * future — so the worker never double-spawns and never spins on the same occurrence.
 *
 * The cadence is computed in the SOURCE TASK CREATOR's timezone (falling back to a first
 * assignee, then UTC) so "daily at midnight" honors the configured zone, not server local.
 */
import prisma from "@/lib/prisma";
import { spawnRecurrence } from "@/lib/recurrence";

export interface ScheduledRunResult {
  scanned: number; // due rules considered this pass
  spawned: number; // instances actually created
  spawnedTaskIds: string[];
  errors: { taskId: string; message: string }[];
}

/**
 * Resolve the timezone to compute a task's cadence in: its creator's, else a first
 * assignee's, else UTC. Names/zone are not row-scoped task content.
 */
async function timeZoneForTask(taskId: string): Promise<string> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      createdBy: { select: { timezone: true } },
      assignees: { select: { timezone: true }, take: 1 },
    },
  });
  return (
    task?.createdBy?.timezone ?? task?.assignees[0]?.timezone ?? "UTC"
  );
}

/**
 * Process every ON_SCHEDULE rule whose `nextRunAt` is due (<= `now`). Single pass: spawn the
 * next instance and let `spawnRecurrence` move the rule (with an advanced `nextRunAt`) onto
 * the fresh copy. Returns a summary. Safe to call repeatedly (idempotent per occurrence).
 *
 * `now` is injectable for tests; defaults to the real UTC clock.
 */
export async function runScheduledRecurrences(
  now: Date = new Date(),
): Promise<ScheduledRunResult> {
  const result: ScheduledRunResult = {
    scanned: 0,
    spawned: 0,
    spawnedTaskIds: [],
    errors: [],
  };

  // Due ON_SCHEDULE rules, on visible (non-archived) tasks. Unscoped by design — the worker
  // is a system actor and processes every user's due rules.
  const due = await prisma.recurrenceRule.findMany({
    where: {
      trigger: "ON_SCHEDULE",
      nextRunAt: { not: null, lte: now },
      task: { archivedAt: null },
    },
    select: { taskId: true },
    orderBy: { nextRunAt: "asc" },
  });

  result.scanned = due.length;

  for (const { taskId } of due) {
    try {
      const tz = await timeZoneForTask(taskId);
      const spawned = await spawnRecurrence({
        taskId,
        timeZone: tz,
        actorId: null, // system actor — no per-user attribution / scope
      });
      if (spawned) {
        result.spawned += 1;
        result.spawnedTaskIds.push(spawned.newTaskId);
      }
    } catch (err) {
      result.errors.push({
        taskId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
