/**
 * Task lifecycle status. Pure, framework-free domain logic.
 * Overdue is DERIVED here, never stored (see DASHBOARD spec / handoff §3).
 */

export type Status = "TODO" | "IN_PROGRESS" | "DONE" | "REVIEWED";

export const STATUSES: Status[] = ["TODO", "IN_PROGRESS", "DONE", "REVIEWED"];

const CLOSED: Status[] = ["DONE", "REVIEWED"];

/** A closed task has reached an end state and no longer counts as overdue. */
export function isClosed(status: Status): boolean {
  return CLOSED.includes(status);
}

/** True when the task has a due date in the past and is still open. */
export function isOverdue(
  task: { status: Status; dueAt: Date | null },
  now: Date,
): boolean {
  if (task.dueAt === null) return false;
  if (isClosed(task.status)) return false;
  return task.dueAt.getTime() < now.getTime();
}
