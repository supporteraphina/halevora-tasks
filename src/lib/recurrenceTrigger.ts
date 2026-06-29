/**
 * Inline ON_STATUS_CHANGE recurrence trigger — the shared hook called by BOTH status paths
 * (the detail `setStatusAction` and the board `changeStatusAction`), exactly as the §6
 * Done-gate was mirrored across both. Keeping it here (one function, one DB read of the
 * rule) means the two call sites stay thin and identical, and the trigger semantics live in
 * the pure `shouldRecurOnStatus` (unit-tested).
 *
 * Called AFTER the status update has been written. It re-reads the task's recurrence rule
 * from the DB (never trusts the client), decides with the pure gate whether this transition
 * fires a recur, and if so delegates to the transactional `spawnRecurrence`. Idempotent:
 * `spawnRecurrence` consumes the rule inside its transaction, so a re-trigger no-ops.
 *
 * Best-effort: a failure here must NOT surface as a status-change error (the status change
 * already succeeded). Errors are swallowed and logged to the console only.
 */
import prisma from "@/lib/prisma";
import { shouldRecurOnStatus } from "@/domain/recurrence";
import { spawnRecurrence } from "@/lib/recurrence";
import type { Status } from "@/domain/status";

export async function maybeRecurOnStatusChange(params: {
  taskId: string;
  oldStatus: Status;
  newStatus: Status;
  actorId: string;
  timeZone: string;
}): Promise<void> {
  const { taskId, oldStatus, newStatus, actorId, timeZone } = params;
  try {
    const rule = await prisma.recurrenceRule.findUnique({
      where: { taskId },
      select: { trigger: true, triggerStatus: true, statusOnRecur: true },
    });
    if (!rule) return;
    if (!shouldRecurOnStatus(rule, oldStatus, newStatus)) return;
    await spawnRecurrence({ taskId, timeZone, actorId });
  } catch (err) {
    // Recurrence is non-critical to the status mutation that already committed.
    console.error("recurrence trigger failed", err);
  }
}
