/**
 * View sort + filter logic. Pure, framework-free domain logic (TDD'd).
 *
 * The list/board views fetch an already-SCOPED task set (every read composes
 * `taskWhereForCurrentUser()` — see src/lib/scope.ts) and then sort/filter it in memory
 * with these helpers. Keeping this pure means a single comparator/predicate is unit-tested
 * once and reused by My Tasks, Today, Reviewed, All-CEO, the calendar, and saved views.
 *
 * Overdue is DERIVED here too (via `isOverdue`), never stored. `now` is passed in so a
 * caller can anchor "overdue" to the actor's clock.
 */

import { type Status, STATUSES, isOverdue } from "./status";
import { type Priority, priorityRank } from "./priority";

/** The minimal task shape the view helpers read. The loaders project tasks into this. */
export interface ViewTask {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  dueAt: Date | null;
  startAt: Date | null;
  createdAt: Date;
  assigneeIds: string[];
  tagIds: string[];
}

/** The keys a view may sort by. */
export type SortKey = "status" | "priority" | "dueAt" | "title" | "createdAt";

/** All sortable keys, in the order they appear in the sort menu. */
export const SORT_KEYS: SortKey[] = [
  "status",
  "priority",
  "dueAt",
  "title",
  "createdAt",
];

export type SortDir = "asc" | "desc";

/** One ordering clause: a key and a direction. A view holds an ordered list of these. */
export interface SortClause {
  key: SortKey;
  dir: SortDir;
}

/** Human labels for the sort menu. */
export const SORT_LABELS: Record<SortKey, string> = {
  status: "Status",
  priority: "Priority",
  dueAt: "Due date",
  title: "Name",
  createdAt: "Created",
};

/** Lifecycle rank for status, so "asc" runs TODO -> IN_PROGRESS -> DONE -> REVIEWED. */
function statusRank(status: Status): number {
  return STATUSES.indexOf(status);
}

/**
 * Raw ascending comparison for a single key (direction applied by the caller).
 * Dates with a null value always sort LAST (after any real date), independent of
 * direction — a missing due date is "no urgency", never "most urgent".
 */
function compareKey(a: ViewTask, b: ViewTask, key: SortKey): number {
  switch (key) {
    case "status":
      return statusRank(a.status) - statusRank(b.status);
    case "priority":
      return priorityRank(a.priority) - priorityRank(b.priority);
    case "title":
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "createdAt":
      return a.createdAt.getTime() - b.createdAt.getTime();
    case "dueAt": {
      // Null due dates are pushed to the end. Signal "this is a null tie/sink" with NaN so
      // the comparator can keep them last regardless of asc/desc.
      const an = a.dueAt;
      const bn = b.dueAt;
      if (an === null && bn === null) return 0;
      if (an === null) return Number.POSITIVE_INFINITY;
      if (bn === null) return Number.NEGATIVE_INFINITY;
      return an.getTime() - bn.getTime();
    }
  }
}

/**
 * Build a comparator from an ordered list of sort clauses. Earlier clauses win;
 * later clauses break ties. An empty list yields a stable no-op (returns 0).
 *
 * For `dueAt`, tasks with no due date are kept at the bottom in BOTH directions: the
 * raw compare returns ±Infinity for a null, and we only negate finite results for `desc`,
 * so a null always reads as "comes after".
 */
export function buildComparator<T extends ViewTask>(
  clauses: SortClause[],
  _now: Date,
): (a: T, b: T) => number {
  // Copy so the caller's array is never mutated, and the closure is stable.
  const ordered = [...clauses];
  return (a, b) => {
    for (const { key, dir } of ordered) {
      const raw = compareKey(a, b, key);
      // Keep null-due "sink" semantics: ±Infinity means "always last", never inverted.
      if (!Number.isFinite(raw)) {
        if (raw === 0) continue;
        return raw > 0 ? 1 : -1;
      }
      if (raw !== 0) return dir === "desc" ? -raw : raw;
    }
    return 0;
  };
}

/** The quick-filter facets. Every facet is optional; an absent/empty facet = no constraint. */
export interface ViewFilter {
  statuses?: Status[];
  priorities?: Priority[];
  assigneeIds?: string[];
  tagIds?: string[];
  hasDue?: boolean;
  overdue?: boolean;
}

/** Does any element of `needles` appear in `haystack`? (empty needles => no constraint) */
function intersects(haystack: string[], needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  return needles.some((n) => haystack.includes(n));
}

/**
 * Does a single task pass the filter? All active facets are ANDed. Empty arrays and
 * undefined facets impose no constraint (so a half-built filter never hides everything).
 */
export function matchesFilter(
  task: ViewTask,
  filter: ViewFilter,
  now: Date,
): boolean {
  if (filter.statuses && filter.statuses.length > 0) {
    if (!filter.statuses.includes(task.status)) return false;
  }
  if (filter.priorities && filter.priorities.length > 0) {
    if (!filter.priorities.includes(task.priority)) return false;
  }
  if (!intersects(task.assigneeIds, filter.assigneeIds)) return false;
  if (!intersects(task.tagIds, filter.tagIds)) return false;
  if (filter.hasDue === true && task.dueAt === null) return false;
  if (filter.overdue === true && !isOverdue(task, now)) return false;
  return true;
}

/** Filter a list, preserving input order. Returns a new array (input untouched). */
export function filterTasks<T extends ViewTask>(
  tasks: T[],
  filter: ViewFilter,
  now: Date,
): T[] {
  return tasks.filter((t) => matchesFilter(t, filter, now));
}

/** Apply a filter then a multi-key sort. Convenience for the loaders/UI. */
export function applyView<T extends ViewTask>(
  tasks: T[],
  filter: ViewFilter,
  sort: SortClause[],
  now: Date,
): T[] {
  return filterTasks(tasks, filter, now).sort(buildComparator<T>(sort, now));
}

// --- Saved-view config (de)serialization ------------------------------------
//
// A SavedView persists its sort + filter as JSON. That JSON is UNTRUSTED on read (a row
// could be hand-edited or stale across a schema change), so we parse defensively: anything
// unrecognized is dropped, never thrown. The result is always a valid filter/sort.

/** The persisted shape of a saved view's config. */
export interface ViewConfig {
  filter: ViewFilter;
  sort: SortClause[];
}

function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}
function isPriority(v: unknown): v is Priority {
  return (
    typeof v === "string" &&
    ["URGENT", "HIGH", "NORMAL", "LOW"].includes(v)
  );
}
function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && (SORT_KEYS as string[]).includes(v);
}
function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Parse an untrusted value into a valid ViewFilter (drops anything unrecognized). */
export function parseFilter(input: unknown): ViewFilter {
  const obj = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const out: ViewFilter = {};
  const statuses = stringArray(obj.statuses).filter(isStatus);
  if (statuses.length > 0) out.statuses = statuses;
  const priorities = stringArray(obj.priorities).filter(isPriority);
  if (priorities.length > 0) out.priorities = priorities;
  const assigneeIds = stringArray(obj.assigneeIds);
  if (assigneeIds.length > 0) out.assigneeIds = assigneeIds;
  const tagIds = stringArray(obj.tagIds);
  if (tagIds.length > 0) out.tagIds = tagIds;
  if (obj.hasDue === true) out.hasDue = true;
  if (obj.overdue === true) out.overdue = true;
  return out;
}

/** Parse an untrusted value into a valid SortClause[] (drops bad clauses). */
export function parseSort(input: unknown): SortClause[] {
  if (!Array.isArray(input)) return [];
  const out: SortClause[] = [];
  const seen = new Set<SortKey>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const clause = raw as Record<string, unknown>;
    if (!isSortKey(clause.key)) continue;
    if (seen.has(clause.key)) continue; // one clause per key
    const dir: SortDir = clause.dir === "desc" ? "desc" : "asc";
    out.push({ key: clause.key, dir });
    seen.add(clause.key);
  }
  return out;
}

/** Parse a whole persisted config blob into a valid { filter, sort }. */
export function parseViewConfig(input: unknown): ViewConfig {
  const obj = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  return { filter: parseFilter(obj.filter), sort: parseSort(obj.sort) };
}
