import { describe, expect, it } from "vitest";
import {
  buildComparator,
  filterTasks,
  matchesFilter,
  parseFilter,
  parseSort,
  parseViewConfig,
  SORT_KEYS,
  type SortClause,
  type ViewFilter,
  type ViewTask,
} from "./views";

/** A small task factory so each test states only the fields it cares about. */
function task(overrides: Partial<ViewTask> = {}): ViewTask {
  return {
    id: "t",
    title: "Task",
    status: "TODO",
    priority: "NORMAL",
    dueAt: null,
    startAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    assigneeIds: [],
    tagIds: [],
    ...overrides,
  };
}

const NOW = new Date("2026-06-29T12:00:00Z");

describe("SORT_KEYS", () => {
  it("exposes the five sortable keys", () => {
    expect(SORT_KEYS).toEqual(["status", "priority", "dueAt", "title", "createdAt"]);
  });
});

describe("buildComparator — multi-key sort", () => {
  it("sorts by a single key ascending (priority: most urgent first)", () => {
    const cmp = buildComparator([{ key: "priority", dir: "asc" }], NOW);
    const sorted = [
      task({ id: "low", priority: "LOW" }),
      task({ id: "urgent", priority: "URGENT" }),
      task({ id: "normal", priority: "NORMAL" }),
    ]
      .sort(cmp)
      .map((t) => t.id);
    expect(sorted).toEqual(["urgent", "normal", "low"]);
  });

  it("reverses with dir:desc", () => {
    const cmp = buildComparator([{ key: "priority", dir: "desc" }], NOW);
    const sorted = [
      task({ id: "urgent", priority: "URGENT" }),
      task({ id: "low", priority: "LOW" }),
    ]
      .sort(cmp)
      .map((t) => t.id);
    expect(sorted).toEqual(["low", "urgent"]);
  });

  it("breaks ties with the second key", () => {
    const cmp = buildComparator(
      [
        { key: "priority", dir: "asc" },
        { key: "title", dir: "asc" },
      ],
      NOW,
    );
    const sorted = [
      task({ id: "b", priority: "HIGH", title: "Bravo" }),
      task({ id: "a", priority: "HIGH", title: "Alpha" }),
      task({ id: "c", priority: "URGENT", title: "Zulu" }),
    ]
      .sort(cmp)
      .map((t) => t.id);
    // URGENT first, then the two HIGH tasks alphabetically.
    expect(sorted).toEqual(["c", "a", "b"]);
  });

  it("sorts dueAt ascending with nulls last regardless of direction", () => {
    const asc = buildComparator([{ key: "dueAt", dir: "asc" }], NOW);
    const sortedAsc = [
      task({ id: "none", dueAt: null }),
      task({ id: "late", dueAt: new Date("2026-07-10T00:00:00Z") }),
      task({ id: "soon", dueAt: new Date("2026-06-30T00:00:00Z") }),
    ]
      .sort(asc)
      .map((t) => t.id);
    expect(sortedAsc).toEqual(["soon", "late", "none"]);

    const desc = buildComparator([{ key: "dueAt", dir: "desc" }], NOW);
    const sortedDesc = [
      task({ id: "none", dueAt: null }),
      task({ id: "late", dueAt: new Date("2026-07-10T00:00:00Z") }),
      task({ id: "soon", dueAt: new Date("2026-06-30T00:00:00Z") }),
    ]
      .sort(desc)
      .map((t) => t.id);
    // Descending by date, but nulls still sink to the bottom.
    expect(sortedDesc).toEqual(["late", "soon", "none"]);
  });

  it("orders status in lifecycle order TODO < IN_PROGRESS < DONE < REVIEWED", () => {
    const cmp = buildComparator([{ key: "status", dir: "asc" }], NOW);
    const sorted = [
      task({ id: "rev", status: "REVIEWED" }),
      task({ id: "todo", status: "TODO" }),
      task({ id: "done", status: "DONE" }),
      task({ id: "prog", status: "IN_PROGRESS" }),
    ]
      .sort(cmp)
      .map((t) => t.id);
    expect(sorted).toEqual(["todo", "prog", "done", "rev"]);
  });

  it("sorts title case-insensitively", () => {
    const cmp = buildComparator([{ key: "title", dir: "asc" }], NOW);
    const sorted = [
      task({ id: "z", title: "zebra" }),
      task({ id: "A", title: "Apple" }),
      task({ id: "m", title: "mango" }),
    ]
      .sort(cmp)
      .map((t) => t.id);
    expect(sorted).toEqual(["A", "m", "z"]);
  });

  it("is a stable no-op with an empty clause list", () => {
    const cmp = buildComparator([], NOW);
    const input = [task({ id: "1" }), task({ id: "2" }), task({ id: "3" })];
    expect([...input].sort(cmp).map((t) => t.id)).toEqual(["1", "2", "3"]);
  });

  it("does not mutate the clause array", () => {
    const clauses: SortClause[] = [{ key: "priority", dir: "asc" }];
    buildComparator(clauses, NOW);
    expect(clauses).toEqual([{ key: "priority", dir: "asc" }]);
  });
});

describe("matchesFilter — single-task predicate", () => {
  it("matches everything with an empty filter", () => {
    expect(matchesFilter(task(), {}, NOW)).toBe(true);
  });

  it("filters by status (any-of)", () => {
    const f: ViewFilter = { statuses: ["TODO", "IN_PROGRESS"] };
    expect(matchesFilter(task({ status: "TODO" }), f, NOW)).toBe(true);
    expect(matchesFilter(task({ status: "DONE" }), f, NOW)).toBe(false);
  });

  it("filters by priority (any-of)", () => {
    const f: ViewFilter = { priorities: ["URGENT"] };
    expect(matchesFilter(task({ priority: "URGENT" }), f, NOW)).toBe(true);
    expect(matchesFilter(task({ priority: "LOW" }), f, NOW)).toBe(false);
  });

  it("filters by assignee (task must include any listed assignee)", () => {
    const f: ViewFilter = { assigneeIds: ["u-1"] };
    expect(matchesFilter(task({ assigneeIds: ["u-1", "u-2"] }), f, NOW)).toBe(true);
    expect(matchesFilter(task({ assigneeIds: ["u-2"] }), f, NOW)).toBe(false);
    expect(matchesFilter(task({ assigneeIds: [] }), f, NOW)).toBe(false);
  });

  it("filters by tag (task must include any listed tag)", () => {
    const f: ViewFilter = { tagIds: ["tag-a"] };
    expect(matchesFilter(task({ tagIds: ["tag-a"] }), f, NOW)).toBe(true);
    expect(matchesFilter(task({ tagIds: ["tag-b"] }), f, NOW)).toBe(false);
  });

  it("filters by has-due", () => {
    const f: ViewFilter = { hasDue: true };
    expect(matchesFilter(task({ dueAt: NOW }), f, NOW)).toBe(true);
    expect(matchesFilter(task({ dueAt: null }), f, NOW)).toBe(false);
  });

  it("filters by overdue (derived: past due AND open)", () => {
    const f: ViewFilter = { overdue: true };
    const past = new Date("2026-06-01T00:00:00Z");
    expect(matchesFilter(task({ dueAt: past, status: "TODO" }), f, NOW)).toBe(true);
    // Closed tasks are never overdue.
    expect(matchesFilter(task({ dueAt: past, status: "DONE" }), f, NOW)).toBe(false);
    // Future due is not overdue.
    const future = new Date("2026-12-01T00:00:00Z");
    expect(matchesFilter(task({ dueAt: future, status: "TODO" }), f, NOW)).toBe(false);
  });

  it("ANDs multiple active facets together", () => {
    const f: ViewFilter = { statuses: ["TODO"], priorities: ["URGENT"] };
    expect(
      matchesFilter(task({ status: "TODO", priority: "URGENT" }), f, NOW),
    ).toBe(true);
    expect(
      matchesFilter(task({ status: "TODO", priority: "LOW" }), f, NOW),
    ).toBe(false);
  });

  it("treats empty facet arrays as 'no constraint', not 'match none'", () => {
    const f: ViewFilter = { statuses: [], priorities: [] };
    expect(matchesFilter(task({ status: "DONE", priority: "LOW" }), f, NOW)).toBe(true);
  });
});

describe("filterTasks — list filter", () => {
  it("keeps only matching tasks and preserves order", () => {
    const tasks = [
      task({ id: "a", status: "TODO" }),
      task({ id: "b", status: "DONE" }),
      task({ id: "c", status: "TODO" }),
    ];
    const out = filterTasks(tasks, { statuses: ["TODO"] }, NOW).map((t) => t.id);
    expect(out).toEqual(["a", "c"]);
  });

  it("returns a new array (does not mutate input)", () => {
    const tasks = [task({ id: "a" })];
    const out = filterTasks(tasks, {}, NOW);
    expect(out).not.toBe(tasks);
    expect(out).toHaveLength(1);
  });
});

describe("parseFilter — defensive parse of untrusted config", () => {
  it("returns an empty filter for junk input", () => {
    expect(parseFilter(null)).toEqual({});
    expect(parseFilter("nope")).toEqual({});
    expect(parseFilter(42)).toEqual({});
    expect(parseFilter({})).toEqual({});
  });

  it("keeps only valid statuses and priorities", () => {
    expect(
      parseFilter({ statuses: ["TODO", "BOGUS"], priorities: ["URGENT", "X"] }),
    ).toEqual({ statuses: ["TODO"], priorities: ["URGENT"] });
  });

  it("drops empty facet arrays entirely", () => {
    expect(parseFilter({ statuses: [], assigneeIds: [] })).toEqual({});
  });

  it("keeps assignee/tag id arrays and boolean facets", () => {
    expect(
      parseFilter({ assigneeIds: ["u-1"], tagIds: ["t-1"], overdue: true, hasDue: true }),
    ).toEqual({ assigneeIds: ["u-1"], tagIds: ["t-1"], overdue: true, hasDue: true });
  });

  it("ignores non-true booleans", () => {
    expect(parseFilter({ overdue: "yes", hasDue: 1 })).toEqual({});
  });
});

describe("parseSort — defensive parse of untrusted config", () => {
  it("returns [] for junk", () => {
    expect(parseSort(null)).toEqual([]);
    expect(parseSort({})).toEqual([]);
  });

  it("keeps valid clauses and drops unknown keys", () => {
    expect(
      parseSort([
        { key: "priority", dir: "desc" },
        { key: "bogus", dir: "asc" },
        { key: "title" },
      ]),
    ).toEqual([
      { key: "priority", dir: "desc" },
      { key: "title", dir: "asc" }, // dir defaults to asc
    ]);
  });

  it("de-duplicates by key (first wins)", () => {
    expect(
      parseSort([
        { key: "status", dir: "asc" },
        { key: "status", dir: "desc" },
      ]),
    ).toEqual([{ key: "status", dir: "asc" }]);
  });
});

describe("parseViewConfig — round-trips a persisted blob", () => {
  it("parses both halves", () => {
    const cfg = parseViewConfig({
      filter: { statuses: ["TODO"], junk: 1 },
      sort: [{ key: "dueAt", dir: "asc" }],
    });
    expect(cfg).toEqual({
      filter: { statuses: ["TODO"] },
      sort: [{ key: "dueAt", dir: "asc" }],
    });
  });

  it("tolerates a totally empty/garbage blob", () => {
    expect(parseViewConfig(undefined)).toEqual({ filter: {}, sort: [] });
  });
});
