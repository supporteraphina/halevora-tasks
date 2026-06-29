/**
 * Human-readable summaries of automation rules (Section 8b). Pure, framework-free — it turns
 * the engine's discriminated-union vocabulary (src/domain/automation.ts) into the short
 * sentences the builder UI shows in the rule list and editor previews. NEVER throws: an
 * unparseable rule yields a safe fallback string, mirroring the engine's defensive idiom.
 *
 * These are LABELS only. No branching here ever decides whether a rule fires — that is the
 * engine's job. We render the same vocabulary the engine evaluates.
 */

import type {
  AutomationTrigger,
  Condition,
  ConditionField,
  ConditionOperator,
  Action,
  TriggerType,
} from "./automation";
import type { Status } from "./status";
import type { Priority } from "./priority";

// ---------------------------------------------------------------------------
// Display labels for each vocabulary token (single source of truth for the UI).
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<Status, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  REVIEWED: "Reviewed",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low",
};

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  status_changed: "Status changes",
  assignee_changed: "Assignee changes",
  priority_changed: "Priority changes",
  due_changed: "Due date changes",
  tag_added: "Tag added",
  scheduled: "On a schedule",
};

export const FIELD_LABELS: Record<ConditionField, string> = {
  status: "Status",
  priority: "Priority",
  title: "Title",
  tags: "Tags",
  assignees: "Assignees",
  dueAt: "Due date",
  startAt: "Start date",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  before: "is before",
  after: "is after",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

export const ACTION_LABELS: Record<Action["type"], string> = {
  set_status: "Set status",
  set_priority: "Set priority",
  assign_user: "Assign",
  unassign_user: "Unassign",
  add_tag: "Add tag",
  remove_tag: "Remove tag",
  post_comment: "Post comment",
};

export const CADENCE_LABELS: Record<string, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
  CUSTOM: "day",
};

function statusLabel(v: unknown): string | null {
  return typeof v === "string" && v in STATUS_LABELS
    ? STATUS_LABELS[v as Status]
    : null;
}
function priorityLabel(v: unknown): string | null {
  return typeof v === "string" && v in PRIORITY_LABELS
    ? PRIORITY_LABELS[v as Priority]
    : null;
}

// ---------------------------------------------------------------------------
// summarizeTrigger — the headline a rule row shows ("When ...").
// ---------------------------------------------------------------------------

/**
 * A short "when this happens" phrase for the trigger, including any narrowing config.
 * Defensive: an unknown trigger type returns a neutral fallback rather than throwing.
 */
export function summarizeTrigger(trigger: AutomationTrigger): string {
  if (!trigger || typeof trigger.type !== "string") return "When something changes";
  const config = trigger.config ?? {};

  switch (trigger.type) {
    case "status_changed": {
      const to = statusLabel(config.to);
      return to ? `When status changes to ${to}` : "When status changes";
    }
    case "priority_changed": {
      const to = priorityLabel(config.to);
      return to ? `When priority changes to ${to}` : "When priority changes";
    }
    case "assignee_changed":
      return "When the assignee changes";
    case "due_changed":
      return "When the due date changes";
    case "tag_added": {
      const tag = typeof config.tag === "string" ? config.tag.trim() : "";
      return tag ? `When the tag "${tag}" is added` : "When any tag is added";
    }
    case "scheduled": {
      const cadence =
        typeof config.cadence === "string" ? config.cadence : "DAILY";
      const interval =
        typeof config.interval === "number" && config.interval >= 1
          ? Math.trunc(config.interval)
          : 1;
      const unit = CADENCE_LABELS[cadence] ?? "day";
      const plural = interval === 1 ? "" : "s";
      return interval === 1
        ? `Every ${unit}`
        : `Every ${interval} ${unit}${plural}`;
    }
    default:
      return "When something changes";
  }
}

// ---------------------------------------------------------------------------
// summarizeCondition — one clause as a phrase ("Priority is Urgent").
// ---------------------------------------------------------------------------

/** Render one condition clause as a readable phrase. Defensive on bad value. */
export function summarizeCondition(cond: Condition): string {
  const field = FIELD_LABELS[cond.field] ?? cond.field;
  const op = OPERATOR_LABELS[cond.operator] ?? cond.operator;

  if (cond.operator === "is_empty" || cond.operator === "is_not_empty") {
    return `${field} ${op}`;
  }

  let value = cond.value ?? "";
  // Render status/priority values with their friendly labels when they match.
  if (cond.field === "status") value = statusLabel(value) ?? value;
  if (cond.field === "priority") value = priorityLabel(value) ?? value;

  return value ? `${field} ${op} ${value}` : `${field} ${op}`;
}

// ---------------------------------------------------------------------------
// summarizeAction — one action as a phrase ("Add tag \"shipped\"").
// ---------------------------------------------------------------------------

/** Render one validated action as a readable phrase. */
export function summarizeAction(action: Action): string {
  switch (action.type) {
    case "set_status":
      return `Set status to ${STATUS_LABELS[action.status]}`;
    case "set_priority":
      return `Set priority to ${PRIORITY_LABELS[action.priority]}`;
    case "assign_user":
      return "Assign a person";
    case "unassign_user":
      return "Unassign a person";
    case "add_tag":
      return `Add tag "${action.tag}"`;
    case "remove_tag":
      return `Remove tag "${action.tag}"`;
    case "post_comment":
      return "Post a comment";
    default:
      return "Do something";
  }
}

// ---------------------------------------------------------------------------
// summarizeActions — the action list joined ("Add tag \"shipped\", then …").
// ---------------------------------------------------------------------------

/** Join an action list into a single readable clause; "" when there are none. */
export function summarizeActions(actions: Action[]): string {
  if (!Array.isArray(actions) || actions.length === 0) return "";
  return actions.map(summarizeAction).join(", then ");
}
