/**
 * Automation engine — pure, framework-free domain logic (Section 8a). The heart of the
 * build-your-own trigger / condition / action rules engine.
 *
 * THE invariant (mirrors "providers never throw" + src/domain/recurrence.ts): every entry
 * point is DEFENSIVE. A stored rule is just Json — it may be malformed, half-built by a
 * future builder UI (8b), or hand-edited. So `parseRule` normalizes/validates a raw value
 * (returns null when unusable), `evaluateConditions` returns a SAFE DEFAULT (true) on
 * garbage, and `planActions` drops anything it cannot understand. NOTHING here throws and
 * NOTHING here touches the database or the framework — the engine glue (src/lib/automation.ts)
 * applies the returned plan.
 *
 * Vocabulary (v1):
 *   triggers   — status_changed, assignee_changed, priority_changed, due_changed,
 *                tag_added, scheduled
 *   conditions — field {status,priority,title,tags,assignees,dueAt,startAt} with operators
 *                equals / not_equals / contains / before / after / is_empty / is_not_empty,
 *                grouped AND (default) or OR ({ match:"all"|"any", conditions:[...] })
 *   actions    — set_status, set_priority, assign_user, unassign_user, add_tag, remove_tag,
 *                post_comment  (ordered; a no-op action is elided from the plan)
 */

import { STATUSES, type Status } from "./status";
import { PRIORITIES, type Priority } from "./priority";

// ---------------------------------------------------------------------------
// Vocabulary constants (the builder UI in 8b renders exactly these)
// ---------------------------------------------------------------------------

export const TRIGGER_TYPES = [
  "status_changed",
  "assignee_changed",
  "priority_changed",
  "due_changed",
  "tag_added",
  "scheduled",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const CONDITION_FIELDS = [
  "status",
  "priority",
  "title",
  "tags",
  "assignees",
  "dueAt",
  "startAt",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "before",
  "after",
  "is_empty",
  "is_not_empty",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const ACTION_TYPES = [
  "set_status",
  "set_priority",
  "assign_user",
  "unassign_user",
  "add_tag",
  "remove_tag",
  "post_comment",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A rule's trigger: a type plus an optional narrowing config (e.g. status `to`). */
export interface AutomationTrigger {
  type: TriggerType;
  config: Record<string, unknown>;
}

/** A single condition clause. `value` is unused for is_empty / is_not_empty. */
export interface Condition {
  field: ConditionField;
  operator: ConditionOperator;
  value?: string;
}

/** A grouped set of conditions joined by all (AND) or any (OR). */
export interface ConditionGroup {
  match: "all" | "any";
  conditions: Condition[];
}

/** Either a flat clause array (implicit AND) or one explicit group. */
export type ConditionInput = Condition[] | ConditionGroup;

/** A discriminated-union action as stored in the rule's `actions` Json array. */
export type Action =
  | { type: "set_status"; status: Status }
  | { type: "set_priority"; priority: Priority }
  | { type: "assign_user"; userId: string }
  | { type: "unassign_user"; userId: string }
  | { type: "add_tag"; tag: string }
  | { type: "remove_tag"; tag: string }
  | { type: "post_comment"; text: string };

/** A fully parsed, validated rule (the engine's working shape). */
export interface AutomationRule {
  id: string;
  boardId: string;
  name: string;
  enabled: boolean;
  order: number;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: Action[];
}

/** The task fields the engine reasons over (read fresh by the glue; never the raw client). */
export interface TaskContext {
  id: string;
  boardId: string;
  title: string;
  status: Status;
  priority: Priority;
  startAt: Date | null;
  dueAt: Date | null;
  tagIds: string[];
  tagNames: string[];
  assigneeIds: string[];
}

/** The event that fired the engine (drives trigger matching). */
export type AutomationEvent =
  | { type: "status_changed"; from: Status; to: Status }
  | { type: "priority_changed"; from: Priority; to: Priority }
  | { type: "assignee_changed"; userId?: string }
  | { type: "due_changed" }
  | { type: "tag_added"; tagName?: string }
  | { type: "scheduled" };

/** An intended mutation the glue applies. A 1:1 mapping of the planned actions. */
export type PlannedMutation =
  | { kind: "set_status"; status: Status }
  | { kind: "set_priority"; priority: Priority }
  | { kind: "assign_user"; userId: string }
  | { kind: "unassign_user"; userId: string }
  | { kind: "add_tag"; tag: string }
  | { kind: "remove_tag"; tag: string }
  | { kind: "post_comment"; text: string };

// ---------------------------------------------------------------------------
// Small safe coercion helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}
function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as string[]).includes(v);
}

// ---------------------------------------------------------------------------
// parseRule — turn raw stored Json into a validated AutomationRule (or null)
// ---------------------------------------------------------------------------

/** Parse one stored condition clause; null if its shape is unusable. */
function parseCondition(raw: unknown): Condition | null {
  if (!isObject(raw)) return null;
  const field = raw.field;
  const operator = raw.operator;
  if (!str(field) || !(CONDITION_FIELDS as readonly string[]).includes(field as string)) {
    return null;
  }
  if (!str(operator) || !(CONDITION_OPERATORS as readonly string[]).includes(operator as string)) {
    return null;
  }
  const value = str(raw.value);
  return {
    field: field as ConditionField,
    operator: operator as ConditionOperator,
    ...(value !== null ? { value } : {}),
  };
}

/** Parse one stored action; null if its shape/payload is invalid. */
function parseAction(raw: unknown): Action | null {
  if (!isObject(raw)) return null;
  const type = str(raw.type);
  if (!type || !(ACTION_TYPES as readonly string[]).includes(type)) return null;

  switch (type as ActionType) {
    case "set_status":
      return isStatus(raw.status) ? { type: "set_status", status: raw.status } : null;
    case "set_priority":
      return isPriority(raw.priority)
        ? { type: "set_priority", priority: raw.priority }
        : null;
    case "assign_user": {
      const userId = str(raw.userId);
      return userId ? { type: "assign_user", userId } : null;
    }
    case "unassign_user": {
      const userId = str(raw.userId);
      return userId ? { type: "unassign_user", userId } : null;
    }
    case "add_tag": {
      const tag = str(raw.tag);
      return tag && tag.trim() ? { type: "add_tag", tag: tag.trim() } : null;
    }
    case "remove_tag": {
      const tag = str(raw.tag);
      return tag && tag.trim() ? { type: "remove_tag", tag: tag.trim() } : null;
    }
    case "post_comment": {
      const text = str(raw.text);
      return text && text.trim() ? { type: "post_comment", text: text.trim() } : null;
    }
    default:
      return null;
  }
}

/** Normalize stored conditions Json into a flat clause array (drops malformed clauses). */
function parseConditionArray(raw: unknown): Condition[] {
  if (Array.isArray(raw)) {
    return raw.map(parseCondition).filter((c): c is Condition => c !== null);
  }
  // Tolerate a stored group shape too, flattening it (the group semantics are handled at
  // evaluation time; parseRule keeps a flat list for the simple stored form).
  if (isObject(raw) && Array.isArray(raw.conditions)) {
    return raw.conditions
      .map(parseCondition)
      .filter((c): c is Condition => c !== null);
  }
  return [];
}

/**
 * Parse a raw stored rule into the validated engine shape. Returns null when the rule is
 * not an object or its trigger type is unknown — those rules simply never run (and the
 * glue logs them as skipped). Conditions/actions are best-effort: malformed entries are
 * dropped, never fatal.
 */
export function parseRule(raw: unknown): AutomationRule | null {
  if (!isObject(raw)) return null;

  const trig = raw.trigger;
  if (!isObject(trig)) return null;
  const tType = str(trig.type);
  if (!tType || !(TRIGGER_TYPES as readonly string[]).includes(tType)) return null;
  const config = isObject(trig.config) ? trig.config : {};

  return {
    id: str(raw.id) ?? "",
    boardId: str(raw.boardId) ?? "",
    name: str(raw.name) ?? "",
    enabled: raw.enabled !== false,
    order: typeof raw.order === "number" ? raw.order : 0,
    trigger: { type: tType as TriggerType, config },
    conditions: parseConditionArray(raw.conditions),
    actions: Array.isArray(raw.actions)
      ? raw.actions.map(parseAction).filter((a): a is Action => a !== null)
      : [],
  };
}

// ---------------------------------------------------------------------------
// triggerMatchesEvent — does this rule's trigger fire for this event?
// ---------------------------------------------------------------------------

/**
 * True when the rule's trigger type matches the event type and any narrowing config holds.
 * Narrowing config is optional:
 *   - status_changed   / priority_changed: config.to may pin the destination value.
 *   - tag_added: config.tag may pin which tag name fires it.
 * The scheduled trigger matches a scheduled event unconditionally.
 */
export function triggerMatchesEvent(
  trigger: AutomationTrigger,
  event: AutomationEvent,
): boolean {
  if (!trigger || trigger.type !== event.type) return false;

  switch (event.type) {
    case "status_changed": {
      const to = str(trigger.config?.to);
      return to ? event.to === to : true;
    }
    case "priority_changed": {
      const to = str(trigger.config?.to);
      return to ? event.to === to : true;
    }
    case "tag_added": {
      const tag = str(trigger.config?.tag);
      if (!tag) return true;
      return (event.tagName ?? "").toLowerCase() === tag.toLowerCase();
    }
    case "assignee_changed":
    case "due_changed":
    case "scheduled":
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// evaluateConditions — do the rule's conditions hold for the task?
// ---------------------------------------------------------------------------

/** Resolve a condition field on the task context to a comparable primitive/collection. */
function fieldValue(field: ConditionField, task: TaskContext): {
  scalar: string | null;
  date: Date | null;
  collection: string[] | null;
} {
  switch (field) {
    case "status":
      return { scalar: task.status, date: null, collection: null };
    case "priority":
      return { scalar: task.priority, date: null, collection: null };
    case "title":
      return { scalar: task.title, date: null, collection: null };
    case "tags":
      return { scalar: null, date: null, collection: task.tagNames };
    case "assignees":
      return { scalar: null, date: null, collection: task.assigneeIds };
    case "dueAt":
      return { scalar: null, date: task.dueAt, collection: null };
    case "startAt":
      return { scalar: null, date: task.startAt, collection: null };
    default:
      return { scalar: null, date: null, collection: null };
  }
}

/** Parse a YYYY-MM-DD (or ISO) condition value to a UTC instant; null if unparseable. */
function parseConditionDate(value: string | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Evaluate ONE clause against the task. Defensive: never throws. */
function evaluateClause(cond: Condition, task: TaskContext): boolean {
  const { scalar, date, collection } = fieldValue(cond.field, task);
  const v = cond.value;

  switch (cond.operator) {
    case "equals":
      if (scalar !== null) return scalar === v;
      if (collection !== null) {
        // For a collection, "equals" means membership (the single value is present).
        return v !== undefined && collection.some((x) => x.toLowerCase() === v.toLowerCase());
      }
      return false;
    case "not_equals":
      if (scalar !== null) return scalar !== v;
      if (collection !== null) {
        return !(v !== undefined && collection.some((x) => x.toLowerCase() === v.toLowerCase()));
      }
      return false;
    case "contains":
      if (scalar !== null) {
        return v !== undefined && scalar.toLowerCase().includes(v.toLowerCase());
      }
      if (collection !== null) {
        return v !== undefined && collection.some((x) => x.toLowerCase() === v.toLowerCase());
      }
      return false;
    case "before": {
      const target = parseConditionDate(v);
      if (date === null || target === null) return false;
      return date.getTime() < target.getTime();
    }
    case "after": {
      const target = parseConditionDate(v);
      if (date === null || target === null) return false;
      return date.getTime() > target.getTime();
    }
    case "is_empty":
      if (collection !== null) return collection.length === 0;
      if (date !== null || scalar !== null) return false;
      return true; // date/scalar field is null/absent
    case "is_not_empty":
      if (collection !== null) return collection.length > 0;
      return date !== null || scalar !== null;
    default:
      // Unknown operator: not a real constraint. Caller treats this list as "no clause".
      return true;
  }
}

/**
 * Evaluate the rule's conditions against the task context. Accepts a flat clause array
 * (implicit AND) or an explicit `{ match, conditions }` group (AND for "all", OR for "any").
 * An empty / all-malformed set is vacuously TRUE (a rule with no conditions always passes).
 *
 * SAFE DEFAULT: garbage input (non-array, non-group) returns true — a malformed condition
 * block must never silently block a rule from a future builder; the glue logs the run.
 */
export function evaluateConditions(
  input: ConditionInput,
  task: TaskContext,
): boolean {
  let match: "all" | "any" = "all";
  let clauses: Condition[];

  if (Array.isArray(input)) {
    clauses = input;
  } else if (isObject(input) && Array.isArray((input as ConditionGroup).conditions)) {
    const group = input as ConditionGroup;
    match = group.match === "any" ? "any" : "all";
    clauses = group.conditions;
  } else {
    return true; // not a recognizable condition shape
  }

  // Drop clauses whose field/operator are unknown — they are not real constraints.
  const valid = clauses
    .map(parseCondition)
    .filter((c): c is Condition => c !== null);

  if (valid.length === 0) return true;

  if (match === "any") {
    return valid.some((c) => evaluateClause(c, task));
  }
  return valid.every((c) => evaluateClause(c, task));
}

// ---------------------------------------------------------------------------
// planActions — ordered intended mutations (no-ops elided, malformed dropped)
// ---------------------------------------------------------------------------

/** Map one validated action to a planned mutation, or null when it would be a no-op. */
function planOne(action: Action, task: TaskContext): PlannedMutation | null {
  switch (action.type) {
    case "set_status":
      return task.status === action.status ? null : { kind: "set_status", status: action.status };
    case "set_priority":
      return task.priority === action.priority
        ? null
        : { kind: "set_priority", priority: action.priority };
    case "assign_user":
      return task.assigneeIds.includes(action.userId)
        ? null
        : { kind: "assign_user", userId: action.userId };
    case "unassign_user":
      return task.assigneeIds.includes(action.userId)
        ? { kind: "unassign_user", userId: action.userId }
        : null;
    case "add_tag":
      return task.tagNames.some((t) => t.toLowerCase() === action.tag.toLowerCase())
        ? null
        : { kind: "add_tag", tag: action.tag };
    case "remove_tag":
      return task.tagNames.some((t) => t.toLowerCase() === action.tag.toLowerCase())
        ? { kind: "remove_tag", tag: action.tag }
        : null;
    case "post_comment":
      return { kind: "post_comment", text: action.text };
    default:
      return null;
  }
}

/**
 * Plan the ordered list of intended mutations for the actions, against the task context.
 * Accepts either already-parsed Action objects or raw stored values — each is re-validated
 * through `parseAction`, so a malformed entry is silently dropped. A no-op (e.g. set_status
 * to the status the task already has, add a tag it already carries) is elided so the glue
 * never performs a redundant write that could needlessly re-trigger another rule.
 *
 * SAFE DEFAULT: garbage input returns [].
 */
export function planActions(
  actions: (Action | unknown)[],
  task: TaskContext,
): PlannedMutation[] {
  if (!Array.isArray(actions)) return [];
  const out: PlannedMutation[] = [];
  for (const raw of actions) {
    const action = parseAction(raw);
    if (!action) continue;
    const planned = planOne(action, task);
    if (planned) out.push(planned);
  }
  return out;
}
