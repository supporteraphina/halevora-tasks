import { describe, it, expect } from "vitest";
import {
  TRIGGER_TYPES,
  CONDITION_OPERATORS,
  ACTION_TYPES,
  parseRule,
  triggerMatchesEvent,
  evaluateConditions,
  planActions,
  type AutomationRule,
  type TaskContext,
  type AutomationEvent,
} from "./automation";

/**
 * The automation engine's pure heart (Section 8a). Given a rule (trigger / conditions /
 * actions) and the task's current context, decide whether the trigger matches the event,
 * whether the conditions hold, and what ordered mutations the actions plan.
 *
 * Mirrors src/domain/recurrence.ts: ALL branching logic lives here, framework-free and
 * exhaustively unit-tested. Like the "providers never throw" idiom, every entry point
 * returns a SAFE DEFAULT on a malformed rule shape — it never throws.
 */

/** A representative task context for the condition/action tests. */
function ctx(over: Partial<TaskContext> = {}): TaskContext {
  return {
    id: "t1",
    boardId: "b1",
    title: "Launch campaign",
    status: "IN_PROGRESS",
    priority: "NORMAL",
    startAt: null,
    dueAt: null,
    tagIds: [],
    tagNames: [],
    assigneeIds: [],
    ...over,
  };
}

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: "r1",
    boardId: "b1",
    name: "Test rule",
    enabled: true,
    order: 0,
    trigger: { type: "status_changed", config: {} },
    conditions: [],
    actions: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Vocabulary surface
// ---------------------------------------------------------------------------

describe("vocabulary", () => {
  it("exposes the v1 trigger types", () => {
    expect(TRIGGER_TYPES).toEqual([
      "status_changed",
      "assignee_changed",
      "priority_changed",
      "due_changed",
      "tag_added",
      "scheduled",
    ]);
  });

  it("exposes the v1 condition operators", () => {
    expect(CONDITION_OPERATORS).toEqual([
      "equals",
      "not_equals",
      "contains",
      "before",
      "after",
      "is_empty",
      "is_not_empty",
    ]);
  });

  it("exposes the v1 action types", () => {
    expect(ACTION_TYPES).toEqual([
      "set_status",
      "set_priority",
      "assign_user",
      "unassign_user",
      "add_tag",
      "remove_tag",
      "post_comment",
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseRule — defensive normalization of stored Json (never throws)
// ---------------------------------------------------------------------------

describe("parseRule", () => {
  it("parses a well-formed rule", () => {
    const parsed = parseRule({
      id: "r1",
      boardId: "b1",
      name: "On done, tag shipped",
      enabled: true,
      order: 1,
      trigger: { type: "status_changed", config: { to: "DONE" } },
      conditions: [],
      actions: [{ type: "add_tag", tag: "shipped" }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.trigger.type).toBe("status_changed");
    expect(parsed?.actions[0]).toEqual({ type: "add_tag", tag: "shipped" });
  });

  it("returns null for a non-object", () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule(42)).toBeNull();
    expect(parseRule("nope")).toBeNull();
  });

  it("returns null for an unknown trigger type", () => {
    expect(
      parseRule(rule({ trigger: { type: "exploded" as never, config: {} } })),
    ).toBeNull();
  });

  it("drops malformed conditions and actions rather than throwing", () => {
    const parsed = parseRule({
      ...rule(),
      conditions: [
        { field: "status", operator: "equals", value: "DONE" },
        { field: "status", operator: "bogus", value: "x" }, // dropped
        "garbage", // dropped
      ],
      actions: [
        { type: "set_status", status: "REVIEWED" },
        { type: "nope" }, // dropped
        null, // dropped
      ],
    });
    expect(parsed?.conditions).toHaveLength(1);
    expect(parsed?.actions).toHaveLength(1);
  });

  it("coerces a missing conditions/actions array to empty", () => {
    const parsed = parseRule({
      id: "r1",
      boardId: "b1",
      name: "x",
      enabled: true,
      order: 0,
      trigger: { type: "scheduled", config: {} },
    });
    expect(parsed?.conditions).toEqual([]);
    expect(parsed?.actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// triggerMatchesEvent
// ---------------------------------------------------------------------------

describe("triggerMatchesEvent", () => {
  it("matches status_changed regardless of target when no `to` configured", () => {
    const ev: AutomationEvent = {
      type: "status_changed",
      from: "TODO",
      to: "DONE",
    };
    expect(triggerMatchesEvent({ type: "status_changed", config: {} }, ev)).toBe(
      true,
    );
  });

  it("matches status_changed only when the configured `to` matches", () => {
    const trigger = { type: "status_changed" as const, config: { to: "DONE" } };
    expect(
      triggerMatchesEvent(trigger, { type: "status_changed", from: "TODO", to: "DONE" }),
    ).toBe(true);
    expect(
      triggerMatchesEvent(trigger, { type: "status_changed", from: "TODO", to: "IN_PROGRESS" }),
    ).toBe(false);
  });

  it("does not match a different event type", () => {
    expect(
      triggerMatchesEvent(
        { type: "status_changed", config: {} },
        { type: "priority_changed", from: "LOW", to: "HIGH" },
      ),
    ).toBe(false);
  });

  it("matches priority_changed with an optional `to` filter", () => {
    const trigger = { type: "priority_changed" as const, config: { to: "URGENT" } };
    expect(
      triggerMatchesEvent(trigger, { type: "priority_changed", from: "NORMAL", to: "URGENT" }),
    ).toBe(true);
    expect(
      triggerMatchesEvent(trigger, { type: "priority_changed", from: "NORMAL", to: "HIGH" }),
    ).toBe(false);
  });

  it("matches assignee_changed and due_changed by type", () => {
    expect(
      triggerMatchesEvent(
        { type: "assignee_changed", config: {} },
        { type: "assignee_changed" },
      ),
    ).toBe(true);
    expect(
      triggerMatchesEvent(
        { type: "due_changed", config: {} },
        { type: "due_changed" },
      ),
    ).toBe(true);
  });

  it("matches tag_added, optionally filtering by tag name", () => {
    expect(
      triggerMatchesEvent(
        { type: "tag_added", config: {} },
        { type: "tag_added", tagName: "urgent" },
      ),
    ).toBe(true);
    expect(
      triggerMatchesEvent(
        { type: "tag_added", config: { tag: "urgent" } },
        { type: "tag_added", tagName: "urgent" },
      ),
    ).toBe(true);
    expect(
      triggerMatchesEvent(
        { type: "tag_added", config: { tag: "design" } },
        { type: "tag_added", tagName: "urgent" },
      ),
    ).toBe(false);
  });

  it("matches the scheduled trigger on a scheduled event", () => {
    expect(
      triggerMatchesEvent(
        { type: "scheduled", config: {} },
        { type: "scheduled" },
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateConditions — operators, AND/OR, missing fields, malformed shapes
// ---------------------------------------------------------------------------

describe("evaluateConditions", () => {
  it("an empty condition set is vacuously true", () => {
    expect(evaluateConditions([], ctx())).toBe(true);
  });

  it("equals on status", () => {
    expect(
      evaluateConditions(
        [{ field: "status", operator: "equals", value: "IN_PROGRESS" }],
        ctx({ status: "IN_PROGRESS" }),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "status", operator: "equals", value: "DONE" }],
        ctx({ status: "IN_PROGRESS" }),
      ),
    ).toBe(false);
  });

  it("not_equals on priority", () => {
    expect(
      evaluateConditions(
        [{ field: "priority", operator: "not_equals", value: "LOW" }],
        ctx({ priority: "HIGH" }),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "priority", operator: "not_equals", value: "HIGH" }],
        ctx({ priority: "HIGH" }),
      ),
    ).toBe(false);
  });

  it("contains on the title (case-insensitive substring)", () => {
    expect(
      evaluateConditions(
        [{ field: "title", operator: "contains", value: "campaign" }],
        ctx({ title: "Launch Campaign now" }),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "title", operator: "contains", value: "invoice" }],
        ctx({ title: "Launch Campaign now" }),
      ),
    ).toBe(false);
  });

  it("contains on tags membership (by name)", () => {
    expect(
      evaluateConditions(
        [{ field: "tags", operator: "contains", value: "urgent" }],
        ctx({ tagNames: ["urgent", "design"] }),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "tags", operator: "contains", value: "research" }],
        ctx({ tagNames: ["urgent", "design"] }),
      ),
    ).toBe(false);
  });

  it("contains on assignees membership (by id)", () => {
    expect(
      evaluateConditions(
        [{ field: "assignees", operator: "contains", value: "u9" }],
        ctx({ assigneeIds: ["u9"] }),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "assignees", operator: "contains", value: "u9" }],
        ctx({ assigneeIds: ["u1"] }),
      ),
    ).toBe(false);
  });

  it("before / after on the due date", () => {
    const due = ctx({ dueAt: new Date("2026-07-01T00:00:00Z") });
    expect(
      evaluateConditions(
        [{ field: "dueAt", operator: "before", value: "2026-07-02" }],
        due,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "dueAt", operator: "after", value: "2026-07-02" }],
        due,
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        [{ field: "dueAt", operator: "after", value: "2026-06-30" }],
        due,
      ),
    ).toBe(true);
  });

  it("before / after are false when the date field is empty (missing field)", () => {
    expect(
      evaluateConditions(
        [{ field: "dueAt", operator: "before", value: "2026-07-02" }],
        ctx({ dueAt: null }),
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        [{ field: "dueAt", operator: "after", value: "2026-07-02" }],
        ctx({ dueAt: null }),
      ),
    ).toBe(false);
  });

  it("is_empty / is_not_empty on the due date", () => {
    expect(
      evaluateConditions(
        [{ field: "dueAt", operator: "is_empty" }],
        ctx({ dueAt: null }),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "dueAt", operator: "is_empty" }],
        ctx({ dueAt: new Date() }),
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        [{ field: "dueAt", operator: "is_not_empty" }],
        ctx({ dueAt: new Date() }),
      ),
    ).toBe(true);
  });

  it("is_empty on tags / assignees collections", () => {
    expect(
      evaluateConditions([{ field: "tags", operator: "is_empty" }], ctx({ tagNames: [] })),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ field: "assignees", operator: "is_empty" }],
        ctx({ assigneeIds: ["u1"] }),
      ),
    ).toBe(false);
  });

  it("defaults to AND across multiple clauses", () => {
    const conds = [
      { field: "status" as const, operator: "equals" as const, value: "DONE" },
      { field: "priority" as const, operator: "equals" as const, value: "URGENT" },
    ];
    expect(evaluateConditions(conds, ctx({ status: "DONE", priority: "URGENT" }))).toBe(true);
    expect(evaluateConditions(conds, ctx({ status: "DONE", priority: "LOW" }))).toBe(false);
  });

  it("honors an explicit OR group", () => {
    const group = {
      match: "any" as const,
      conditions: [
        { field: "priority" as const, operator: "equals" as const, value: "URGENT" },
        { field: "priority" as const, operator: "equals" as const, value: "HIGH" },
      ],
    };
    expect(evaluateConditions(group, ctx({ priority: "HIGH" }))).toBe(true);
    expect(evaluateConditions(group, ctx({ priority: "LOW" }))).toBe(false);
  });

  it("honors an explicit AND group", () => {
    const group = {
      match: "all" as const,
      conditions: [
        { field: "status" as const, operator: "equals" as const, value: "DONE" },
        { field: "tags" as const, operator: "contains" as const, value: "shipped" },
      ],
    };
    expect(
      evaluateConditions(group, ctx({ status: "DONE", tagNames: ["shipped"] })),
    ).toBe(true);
    expect(
      evaluateConditions(group, ctx({ status: "DONE", tagNames: [] })),
    ).toBe(false);
  });

  it("a malformed condition shape is ignored (treated as no constraint)", () => {
    // A single unknown-operator clause => no valid constraints => vacuously true.
    expect(
      evaluateConditions(
        [{ field: "status", operator: "explode" as never, value: "x" }],
        ctx(),
      ),
    ).toBe(true);
  });

  it("never throws on garbage input — returns a safe default (true)", () => {
    expect(evaluateConditions("not conditions" as never, ctx())).toBe(true);
    expect(evaluateConditions(null as never, ctx())).toBe(true);
    expect(evaluateConditions(42 as never, ctx())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// planActions — ordered intended mutations, no-ops elided, malformed dropped
// ---------------------------------------------------------------------------

describe("planActions", () => {
  it("plans a set_status mutation", () => {
    const plan = planActions(
      [{ type: "set_status", status: "REVIEWED" }],
      ctx({ status: "DONE" }),
    );
    expect(plan).toEqual([{ kind: "set_status", status: "REVIEWED" }]);
  });

  it("elides a set_status that is a no-op (already that status)", () => {
    const plan = planActions(
      [{ type: "set_status", status: "DONE" }],
      ctx({ status: "DONE" }),
    );
    expect(plan).toEqual([]);
  });

  it("elides a set_priority no-op", () => {
    const plan = planActions(
      [{ type: "set_priority", priority: "NORMAL" }],
      ctx({ priority: "NORMAL" }),
    );
    expect(plan).toEqual([]);
  });

  it("plans assign / unassign and elides their no-ops", () => {
    expect(
      planActions([{ type: "assign_user", userId: "u2" }], ctx({ assigneeIds: ["u1"] })),
    ).toEqual([{ kind: "assign_user", userId: "u2" }]);
    // already assigned => no-op
    expect(
      planActions([{ type: "assign_user", userId: "u1" }], ctx({ assigneeIds: ["u1"] })),
    ).toEqual([]);
    // not assigned => unassign is a no-op
    expect(
      planActions([{ type: "unassign_user", userId: "u9" }], ctx({ assigneeIds: ["u1"] })),
    ).toEqual([]);
    expect(
      planActions([{ type: "unassign_user", userId: "u1" }], ctx({ assigneeIds: ["u1"] })),
    ).toEqual([{ kind: "unassign_user", userId: "u1" }]);
  });

  it("plans add_tag / remove_tag and elides their no-ops (by name)", () => {
    expect(
      planActions([{ type: "add_tag", tag: "shipped" }], ctx({ tagNames: [] })),
    ).toEqual([{ kind: "add_tag", tag: "shipped" }]);
    // already tagged => no-op (case-insensitive)
    expect(
      planActions([{ type: "add_tag", tag: "Shipped" }], ctx({ tagNames: ["shipped"] })),
    ).toEqual([]);
    expect(
      planActions([{ type: "remove_tag", tag: "shipped" }], ctx({ tagNames: ["shipped"] })),
    ).toEqual([{ kind: "remove_tag", tag: "shipped" }]);
    // not present => removing is a no-op
    expect(
      planActions([{ type: "remove_tag", tag: "ghost" }], ctx({ tagNames: ["shipped"] })),
    ).toEqual([]);
  });

  it("plans a post_comment action (never a no-op)", () => {
    expect(
      planActions([{ type: "post_comment", text: "Auto: shipped" }], ctx()),
    ).toEqual([{ kind: "post_comment", text: "Auto: shipped" }]);
  });

  it("preserves action order", () => {
    const plan = planActions(
      [
        { type: "set_status", status: "REVIEWED" },
        { type: "add_tag", tag: "shipped" },
        { type: "post_comment", text: "done" },
      ],
      ctx({ status: "DONE", tagNames: [] }),
    );
    expect(plan.map((p) => p.kind)).toEqual([
      "set_status",
      "add_tag",
      "post_comment",
    ]);
  });

  it("drops malformed actions and never throws", () => {
    const plan = planActions(
      [
        { type: "set_status", status: "NOPE" }, // bad status -> dropped
        { type: "add_tag" }, // missing tag -> dropped
        { type: "weird" } as never, // unknown -> dropped
        { type: "post_comment", text: "" }, // empty text -> dropped
        { type: "post_comment", text: "ok" }, // kept
      ],
      ctx(),
    );
    expect(plan).toEqual([{ kind: "post_comment", text: "ok" }]);
  });

  it("never throws on garbage input — returns []", () => {
    expect(planActions("nope" as never, ctx())).toEqual([]);
    expect(planActions(null as never, ctx())).toEqual([]);
  });
});
