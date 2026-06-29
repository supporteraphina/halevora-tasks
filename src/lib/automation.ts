/**
 * Automation execution glue — the server half of Section 8a. Loads a board's enabled
 * `AutomationRule`s, runs the PURE engine (src/domain/automation.ts) over a fresh task
 * context, applies the planned mutations as SYSTEM writes, and appends one append-only
 * `AutomationRunLog` row per rule. Mirrors the recurrence trigger pattern: the branching
 * logic lives in the pure domain module; this file is DB glue only.
 *
 * SECURITY / SCOPE:
 *   - User-triggered paths (status / priority / assignee / due / tag mutations in the board
 *     + detail actions) re-authorize the source task via `findVisibleTask` BEFORE calling
 *     here. Once authorized, the automation's OWN writes are SYSTEM writes — they are not
 *     re-scoped to the actor (a rule may legitimately assign someone else, add a tag, etc.,
 *     exactly like §7's worker writes are unscoped). We never WIDEN a member's read scope
 *     incorrectly: scope is enforced on READ at the board/detail surfaces, not here.
 *   - The scheduled pass (src/lib/automationWorker.ts) runs WITHOUT a session — `actorId`
 *     is null (system actor), like §7's recurrence worker.
 *
 * LOOP-GUARD / RE-ENTRANCY:
 *   An action that changes status / priority / assignee can itself satisfy another rule's
 *   trigger. We pass a `depth` counter through the event chain and STOP at MAX_DEPTH so a
 *   rule (or a pair of rules) that would re-fire itself can never loop infinitely. Each
 *   applied state-changing mutation re-enters `runAutomationsForEvent` with depth + 1; once
 *   the cap is hit we apply mutations but do NOT cascade further events.
 *
 * BEST-EFFORT: a failure inside automation must NOT fail the user's underlying mutation
 * (which already committed). Per-rule errors are caught, logged as an `error` run row, and
 * the pass continues.
 */
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  parseRule,
  triggerMatchesEvent,
  evaluateConditions,
  planActions,
  type AutomationEvent,
  type TaskContext,
  type PlannedMutation,
} from "@/domain/automation";

/** Re-entrancy cap: an automation cascade may chain at most this many event hops deep. */
export const MAX_AUTOMATION_DEPTH = 5;

export interface RunAutomationsParams {
  boardId: string;
  taskId: string;
  event: AutomationEvent;
  /** Who to attribute resulting activity to; null for the system/scheduled actor. */
  actorId: string | null;
  /** Re-entrancy depth (defaults 0). Increments on each cascaded event. */
  depth?: number;
}

export interface RunAutomationsResult {
  evaluated: number; // rules considered (enabled, on this board)
  applied: number; // rules that ran at least one mutation (status "success")
  skipped: number; // rules whose trigger or conditions did not match (status "skipped")
  errored: number; // rules that threw (status "error")
}

/** Build the pure engine's task context from a fresh DB read (never trust the client). */
async function loadTaskContext(taskId: string): Promise<TaskContext | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      boardId: true,
      title: true,
      status: true,
      priority: true,
      startAt: true,
      dueAt: true,
      tags: { select: { id: true, name: true } },
      assignees: { select: { id: true } },
    },
  });
  if (!task) return null;
  return {
    id: task.id,
    boardId: task.boardId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    startAt: task.startAt,
    dueAt: task.dueAt,
    tagIds: task.tags.map((t) => t.id),
    tagNames: task.tags.map((t) => t.name),
    assigneeIds: task.assignees.map((a) => a.id),
  };
}

/** A mutation that changes task state we trigger on => emits a cascade event (loop-guarded). */
function cascadeEventFor(
  mutation: PlannedMutation,
  before: TaskContext,
): AutomationEvent | null {
  switch (mutation.kind) {
    case "set_status":
      return { type: "status_changed", from: before.status, to: mutation.status };
    case "set_priority":
      return { type: "priority_changed", from: before.priority, to: mutation.priority };
    case "assign_user":
    case "unassign_user":
      return { type: "assignee_changed", userId: mutation.userId };
    case "add_tag":
      return { type: "tag_added", tagName: mutation.tag };
    case "remove_tag":
    case "post_comment":
      return null; // not a trigger source in v1
    default:
      return null;
  }
}

/**
 * Apply ONE planned mutation as a system write. Returns the kind applied (for logging) or
 * null when the mutation could not be carried out (e.g. assign a user id that doesn't
 * exist, add/remove a tag). Tag writes upsert/connect by name so a rule can reference a tag
 * that may not exist yet. NEVER throws to the caller's loop — the caller wraps in try/catch.
 */
async function applyMutation(
  taskId: string,
  boardId: string,
  actorId: string | null,
  mutation: PlannedMutation,
): Promise<boolean> {
  switch (mutation.kind) {
    case "set_status":
      await prisma.task.update({ where: { id: taskId }, data: { status: mutation.status } });
      return true;
    case "set_priority":
      await prisma.task.update({
        where: { id: taskId },
        data: { priority: mutation.priority },
      });
      return true;
    case "assign_user": {
      // Only connect a real user (any user may be assigned; scope is on READ).
      const user = await prisma.user.findUnique({
        where: { id: mutation.userId },
        select: { id: true },
      });
      if (!user) return false;
      await prisma.task.update({
        where: { id: taskId },
        data: { assignees: { connect: { id: user.id } } },
      });
      return true;
    }
    case "unassign_user": {
      await prisma.task.update({
        where: { id: taskId },
        data: { assignees: { disconnect: { id: mutation.userId } } },
      });
      return true;
    }
    case "add_tag": {
      const tag = await prisma.tag.upsert({
        where: { name: mutation.tag },
        update: {},
        create: { name: mutation.tag },
        select: { id: true },
      });
      await prisma.task.update({
        where: { id: taskId },
        data: { tags: { connect: { id: tag.id } } },
      });
      return true;
    }
    case "remove_tag": {
      const tag = await prisma.tag.findUnique({
        where: { name: mutation.tag },
        select: { id: true },
      });
      if (!tag) return false;
      await prisma.task.update({
        where: { id: taskId },
        data: { tags: { disconnect: { id: tag.id } } },
      });
      return true;
    }
    case "post_comment": {
      // A system comment is a Tiptap doc with the rule's text. authorId null = "system".
      const body = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: mutation.text }] },
        ],
      };
      await prisma.comment.create({
        data: {
          taskId,
          authorId: actorId, // null => system-authored comment
          body: body as Prisma.InputJsonValue,
        },
      });
      return true;
    }
    default:
      return false;
  }
}

/** Append one append-only run row for a rule evaluation. Best-effort (never throws). */
async function logRun(
  ruleId: string,
  taskId: string | null,
  status: "success" | "skipped" | "error",
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.automationRunLog.create({
      data: {
        ruleId,
        taskId,
        status,
        detail: detail as Prisma.InputJsonValue,
      },
    });
  } catch {
    // The run log is non-critical to the mutation that already committed.
  }
}

/**
 * Run all enabled automation rules for a board against the task that fired `event`. Loads
 * rules in `order`, evaluates the pure engine, applies planned mutations as system writes,
 * logs one run row per rule, and (loop-guarded) cascades any state-changing mutation as a
 * follow-on event. Best-effort: a rule that throws is logged as `error` and the pass
 * continues; this function never throws to its caller.
 *
 * Returns a small summary (handy for the scheduled worker + tests).
 */
export async function runAutomationsForEvent(
  params: RunAutomationsParams,
): Promise<RunAutomationsResult> {
  const { boardId, taskId, event, actorId } = params;
  const depth = params.depth ?? 0;
  const result: RunAutomationsResult = {
    evaluated: 0,
    applied: 0,
    skipped: 0,
    errored: 0,
  };

  // Loop-guard: stop cascading once the re-entrancy cap is reached. We still return cleanly
  // (the mutation that triggered this hop already committed); we just don't fan out further.
  if (depth >= MAX_AUTOMATION_DEPTH) return result;

  let rules;
  try {
    rules = await prisma.automationRule.findMany({
      where: { boardId, enabled: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        boardId: true,
        name: true,
        enabled: true,
        order: true,
        trigger: true,
        conditions: true,
        actions: true,
      },
    });
  } catch (err) {
    console.error("automation: failed to load rules", err);
    return result;
  }

  for (const raw of rules) {
    const parsed = parseRule(raw);
    if (!parsed) {
      result.skipped += 1;
      await logRun(raw.id, taskId, "skipped", { reason: "malformed_rule" });
      continue;
    }

    try {
      // The trigger must match this event.
      if (!triggerMatchesEvent(parsed.trigger, event)) {
        result.skipped += 1;
        await logRun(parsed.id, taskId, "skipped", { reason: "trigger_mismatch" });
        continue;
      }

      // Re-read the task fresh for each rule — a previous rule in this pass may have
      // mutated it, and we never trust the client for current state.
      const ctx = await loadTaskContext(taskId);
      if (!ctx) {
        result.skipped += 1;
        await logRun(parsed.id, taskId, "skipped", { reason: "task_missing" });
        continue;
      }

      if (!evaluateConditions(parsed.conditions, ctx)) {
        result.skipped += 1;
        await logRun(parsed.id, taskId, "skipped", { reason: "conditions_unmet" });
        continue;
      }

      const plan = planActions(parsed.actions, ctx);
      if (plan.length === 0) {
        result.skipped += 1;
        await logRun(parsed.id, taskId, "skipped", { reason: "no_op" });
        continue;
      }

      // Apply each planned mutation; collect cascade events for state-changing ones.
      const appliedKinds: string[] = [];
      const cascades: AutomationEvent[] = [];
      for (const mutation of plan) {
        let applied = false;
        try {
          applied = await applyMutation(taskId, boardId, actorId, mutation);
        } catch (mErr) {
          console.error("automation: mutation failed", mErr);
          applied = false;
        }
        if (applied) {
          appliedKinds.push(mutation.kind);
          const ev = cascadeEventFor(mutation, ctx);
          if (ev) cascades.push(ev);
        }
      }

      if (appliedKinds.length === 0) {
        result.skipped += 1;
        await logRun(parsed.id, taskId, "skipped", { reason: "no_mutation_applied" });
        continue;
      }

      result.applied += 1;
      await logRun(parsed.id, taskId, "success", {
        rule: parsed.name,
        applied: appliedKinds,
        depth,
      });
      // Append-only activity. The actor may be null (the system/scheduled actor), so write
      // directly rather than via recordActivity (which requires a non-null actorId).
      try {
        await prisma.activityLog.create({
          data: {
            taskId,
            boardId,
            actorId,
            type: "automation_ran",
            data: { rule: parsed.name, applied: appliedKinds } as Prisma.InputJsonValue,
          },
        });
      } catch {
        // Activity logging is non-critical to the mutation that already committed.
      }

      // Loop-guarded cascade: re-run automations for each state-changing mutation, deeper.
      for (const ev of cascades) {
        const sub = await runAutomationsForEvent({
          boardId,
          taskId,
          event: ev,
          actorId,
          depth: depth + 1,
        });
        result.applied += sub.applied;
        result.skipped += sub.skipped;
        result.errored += sub.errored;
        result.evaluated += sub.evaluated;
      }
    } catch (err) {
      result.errored += 1;
      console.error("automation: rule evaluation failed", err);
      await logRun(parsed.id, taskId, "error", {
        rule: parsed.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  result.evaluated += rules.length;
  return result;
}
