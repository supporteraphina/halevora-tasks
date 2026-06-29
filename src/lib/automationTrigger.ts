/**
 * Inline automation triggers — the shared hooks the user-triggered action paths call after
 * a mutation commits, exactly as `recurrenceTrigger.ts` is mirrored across both status
 * paths. Keeping the event-construction here (one tiny function per event kind) keeps the
 * call sites in `board/actions.ts` and `board/task/actions.ts` thin and identical.
 *
 * Each hook is BEST-EFFORT: it must never surface as an error on the underlying mutation
 * (which already succeeded). `runAutomationsForEvent` itself swallows per-rule errors and
 * logs run rows; we wrap the whole call in a try/catch as a final belt-and-suspenders so a
 * load failure can never break a status change / assignment / date edit.
 *
 * The caller MUST have already re-authorized the source task (via `findVisibleTask`). The
 * automation's own writes are SYSTEM writes (not re-scoped to the actor) — see automation.ts.
 */
import { runAutomationsForEvent } from "@/lib/automation";
import type { AutomationEvent } from "@/domain/automation";
import type { Status } from "@/domain/status";
import type { Priority } from "@/domain/priority";

interface BaseParams {
  boardId: string;
  taskId: string;
  actorId: string | null;
}

async function fire(params: BaseParams, event: AutomationEvent): Promise<void> {
  try {
    await runAutomationsForEvent({
      boardId: params.boardId,
      taskId: params.taskId,
      event,
      actorId: params.actorId,
    });
  } catch (err) {
    console.error("automation trigger failed", err);
  }
}

/** Fire automations for a status transition. */
export async function onStatusChanged(
  params: BaseParams & { from: Status; to: Status },
): Promise<void> {
  if (params.from === params.to) return;
  await fire(params, { type: "status_changed", from: params.from, to: params.to });
}

/** Fire automations for a priority change. */
export async function onPriorityChanged(
  params: BaseParams & { from: Priority; to: Priority },
): Promise<void> {
  if (params.from === params.to) return;
  await fire(params, { type: "priority_changed", from: params.from, to: params.to });
}

/** Fire automations for an assignee add/remove. */
export async function onAssigneeChanged(
  params: BaseParams & { userId: string },
): Promise<void> {
  await fire(params, { type: "assignee_changed", userId: params.userId });
}

/** Fire automations for a due-date change. */
export async function onDueChanged(params: BaseParams): Promise<void> {
  await fire(params, { type: "due_changed" });
}

/** Fire automations for a tag being added (by tag name). */
export async function onTagAdded(
  params: BaseParams & { tagName: string },
): Promise<void> {
  await fire(params, { type: "tag_added", tagName: params.tagName });
}
