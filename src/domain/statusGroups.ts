/**
 * The grouped status dropdown + card badge. Pure, framework-free domain logic.
 *
 * ClickUp groups its statuses (Not started / Active / Done / Closed); we mirror that
 * grouping over our four STORED statuses. OVERDUE is NOT a stored status and is never
 * selectable — it is DERIVED at render via `isOverdue` (see src/domain/status.ts). The
 * card badge shows OVERDUE (red) for an open, past-due task, otherwise the stored status.
 */

import type { Status } from "./status";
import { isOverdue } from "./status";

/** A group in the status dropdown — a ClickUp-style section header over stored statuses. */
export interface StatusGroup {
  label: string;
  statuses: Status[];
}

/** The dropdown, grouped exactly like ClickUp. Selecting writes only a stored status. */
export const STATUS_GROUPS: StatusGroup[] = [
  { label: "Not started", statuses: ["TODO"] },
  { label: "Active", statuses: ["IN_PROGRESS"] },
  { label: "Done", statuses: ["DONE"] },
  { label: "Closed", statuses: ["REVIEWED"] },
];

/** Human badge text for each stored status. */
export const STATUS_LABELS: Record<Status, string> = {
  TODO: "TO DO",
  IN_PROGRESS: "IN PROGRESS",
  DONE: "DONE",
  REVIEWED: "REVIEWED",
};

/** What the card badge shows: a derived OVERDUE, or the stored status. `key` drives color. */
export type BadgeKey = Status | "OVERDUE";

export interface Badge {
  key: BadgeKey;
  label: string;
}

/** The badge for a card right now. OVERDUE is derived, never read from storage. */
export function badgeFor(
  task: { status: Status; dueAt: Date | null },
  now: Date,
): Badge {
  if (isOverdue(task, now)) return { key: "OVERDUE", label: "OVERDUE" };
  return { key: task.status, label: STATUS_LABELS[task.status] };
}
