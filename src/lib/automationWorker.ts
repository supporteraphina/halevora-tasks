/**
 * Scheduled automation worker — the time-based (`scheduled` trigger) path. Reusable +
 * unit-testable single-pass processing that finds due `AutomationRule`s (by `nextRunAt <=
 * now`), fires each against the eligible tasks on its board, and advances the rule's
 * `nextRunAt` by its cadence so it runs again next interval. Shares the SAME shape as §7's
 * `runScheduledRecurrences` (and the `/api/recurrence/run` route style) — see
 * src/lib/recurrenceWorker.ts.
 *
 * SECURITY: this runs WITHOUT a session. It is a trusted SYSTEM actor (`actorId: null`) and
 * deliberately applies NO per-user scope (it processes every due rule across all boards).
 * The clock basis is UTC (`new Date()`). Each rule is processed at most once per tick: its
 * `nextRunAt` is advanced strictly into the future, so the worker never double-fires or
 * spins on the same occurrence.
 *
 * A `scheduled` rule's `trigger.config.cadence` ("DAILY" | "WEEKLY" | "MONTHLY") and
 * `config.interval` (>=1, default 1) set the repeat step; the default is daily. Tasks are
 * matched by the rule's own conditions inside `runAutomationsForEvent` (a `scheduled` event),
 * so a rule with no conditions touches every non-archived top-level task on the board, while
 * a conditioned rule narrows it (e.g. "every day, on tasks past due, post a reminder").
 */
import prisma from "@/lib/prisma";
import { runAutomationsForEvent } from "@/lib/automation";
import { parseRule } from "@/domain/automation";
import { advanceDate, type RecurrenceSpec } from "@/domain/recurrence";
import type { Cadence } from "@prisma/client";

export interface ScheduledAutomationResult {
  scanned: number; // due rules considered this pass
  fired: number; // rules whose actions applied to >= 1 task
  applied: number; // total per-task rule applications
  errors: { ruleId: string; message: string }[];
}

const VALID_CADENCES: Cadence[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"];

/** Read the repeat cadence/interval from a scheduled rule's trigger config (default daily). */
function cadenceSpecFor(config: Record<string, unknown>): RecurrenceSpec {
  const rawCadence = typeof config.cadence === "string" ? config.cadence : "DAILY";
  const cadence = (VALID_CADENCES as string[]).includes(rawCadence)
    ? (rawCadence as Cadence)
    : "DAILY";
  const rawInterval = Number(config.interval ?? 1);
  const interval = Number.isFinite(rawInterval) && rawInterval >= 1 ? Math.trunc(rawInterval) : 1;
  return { cadence, interval };
}

/**
 * Process every enabled `scheduled` automation rule whose `nextRunAt` is due (<= `now`).
 * For each rule: run it against every non-archived top-level task on its board (the engine's
 * conditions narrow which tasks actually change), then advance the rule's `nextRunAt` by its
 * cadence (strictly into the future). Returns a summary. Safe to call repeatedly.
 *
 * `now` is injectable for tests; defaults to the real UTC clock.
 */
export async function runScheduledAutomations(
  now: Date = new Date(),
): Promise<ScheduledAutomationResult> {
  const result: ScheduledAutomationResult = {
    scanned: 0,
    fired: 0,
    applied: 0,
    errors: [],
  };

  // Due scheduled rules. Unscoped by design — the worker is a system actor.
  const due = await prisma.automationRule.findMany({
    where: {
      enabled: true,
      nextRunAt: { not: null, lte: now },
    },
    orderBy: { nextRunAt: "asc" },
    select: {
      id: true,
      boardId: true,
      name: true,
      enabled: true,
      order: true,
      trigger: true,
      conditions: true,
      actions: true,
      nextRunAt: true,
    },
  });

  result.scanned = due.length;

  for (const ruleRow of due) {
    try {
      const parsed = parseRule(ruleRow);
      // Only a well-formed `scheduled` rule fires here; others still get their clock advanced
      // so a malformed/retyped rule does not get re-scanned every tick forever.
      if (parsed && parsed.trigger.type === "scheduled") {
        const tasks = await prisma.task.findMany({
          where: { boardId: ruleRow.boardId, parentId: null, archivedAt: null },
          select: { id: true },
        });
        let firedAny = false;
        for (const task of tasks) {
          const r = await runAutomationsForEvent({
            boardId: ruleRow.boardId,
            taskId: task.id,
            event: { type: "scheduled" },
            actorId: null, // system actor — no per-user attribution / scope
          });
          if (r.applied > 0) {
            result.applied += r.applied;
            firedAny = true;
          }
        }
        if (firedAny) result.fired += 1;
      }

      // Advance the clock strictly into the future so we never re-scan this occurrence.
      const spec = cadenceSpecFor(
        parsed?.trigger.config ?? {},
      );
      let next = advanceDate(ruleRow.nextRunAt ?? now, spec, "UTC");
      // Guard: if the prior nextRunAt was stale (many intervals behind), keep stepping until
      // strictly future so one tick can't loop forever yet always lands ahead of `now`.
      let guard = 0;
      while (next.getTime() <= now.getTime() && guard < 4000) {
        next = advanceDate(next, spec, "UTC");
        guard += 1;
      }
      await prisma.automationRule.update({
        where: { id: ruleRow.id },
        data: { nextRunAt: next },
      });
    } catch (err) {
      result.errors.push({
        ruleId: ruleRow.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
