/**
 * Activity log — pure labeling for the append-only audit feed.
 *
 * `ActivityLog` is APPEND-ONLY (see prisma/schema.prisma): app code only ever inserts
 * rows, never updates or deletes them. This module turns a stored `(type, data)` pair into
 * a human phrase for the combined comments + activity feed. The actor's name is prepended
 * in the UI (e.g. "Noel changed status from To Do to Done"), so phrases start with a verb.
 *
 * Framework-free + unit-tested so the wording stays stable and the emit sites stay thin.
 */

import type { Status } from "./status";
import type { Priority } from "./priority";

export const ACTIVITY_TYPES = [
  "status_changed",
  "priority_changed",
  "assignee_added",
  "assignee_removed",
  "due_changed",
  "start_changed",
  "comment_created",
  "attachment_added",
  "attachment_removed",
  "custom_field_set",
  "dependency_added",
  "dependency_removed",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const STATUS_LABEL: Record<Status, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  REVIEWED: "Reviewed",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low",
};

function statusText(v: unknown): string | null {
  return typeof v === "string" && v in STATUS_LABEL
    ? STATUS_LABEL[v as Status]
    : null;
}
function priorityText(v: unknown): string | null {
  return typeof v === "string" && v in PRIORITY_LABEL
    ? PRIORITY_LABEL[v as Priority]
    : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Render an activity entry as a verb phrase. `data` is the stored JSON payload; any
 * missing field degrades to a shorter readable phrase (never throws, never shows raw JSON).
 */
export function describeActivity(type: string, data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;

  switch (type) {
    case "status_changed": {
      const from = statusText(d.from);
      const to = statusText(d.to);
      if (from && to) return `changed status from ${from} to ${to}`;
      if (to) return `changed status to ${to}`;
      return "changed status";
    }
    case "priority_changed": {
      const from = priorityText(d.from);
      const to = priorityText(d.to);
      if (from && to) return `changed priority from ${from} to ${to}`;
      if (to) return `changed priority to ${to}`;
      return "changed priority";
    }
    case "assignee_added":
      return `assigned ${str(d.name) ?? "someone"}`;
    case "assignee_removed":
      return `unassigned ${str(d.name) ?? "someone"}`;
    case "due_changed": {
      const to = str(d.to);
      return to ? `set the due date to ${to}` : "cleared the due date";
    }
    case "start_changed": {
      const to = str(d.to);
      return to ? `set the start date to ${to}` : "cleared the start date";
    }
    case "comment_created":
      return "commented";
    case "attachment_added":
      return `attached ${str(d.filename) ?? "a file"}`;
    case "attachment_removed":
      return `removed attachment ${str(d.filename) ?? ""}`.trimEnd();
    case "custom_field_set":
      return `updated ${str(d.field) ?? "a field"}`;
    case "dependency_added": {
      const other = str(d.title) ?? "a task";
      return d.direction === "waiting_on"
        ? `added a "waiting on" link to ${other}`
        : `added a "blocking" link to ${other}`;
    }
    case "dependency_removed": {
      const other = str(d.title) ?? "a task";
      return `removed a dependency link to ${other}`;
    }
    default:
      return "made a change";
  }
}
