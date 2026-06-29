import { describe, expect, it } from "vitest";
import { taskScopeWhere, canSeeTask } from "./scope";

describe("taskScopeWhere — row-level task visibility", () => {
  it("returns an empty where ({}) for a CEO, so they see ALL tasks", () => {
    expect(taskScopeWhere({ role: "CEO", userId: "u-ceo" })).toEqual({});
  });

  it("scopes a MEMBER to tasks they are an assignee of", () => {
    expect(taskScopeWhere({ role: "MEMBER", userId: "u-1" })).toEqual({
      assignees: { some: { id: "u-1" } },
    });
  });

  it("scopes each MEMBER to their own id (no cross-member leak)", () => {
    const a = taskScopeWhere({ role: "MEMBER", userId: "u-a" });
    const b = taskScopeWhere({ role: "MEMBER", userId: "u-b" });
    expect(a).not.toEqual(b);
    expect(a).toEqual({ assignees: { some: { id: "u-a" } } });
    expect(b).toEqual({ assignees: { some: { id: "u-b" } } });
  });

  it("scopes a subtask the same way as a top-level task — by its OWN assignees", () => {
    // Subtasks are Tasks (self-relation via parentId). A member sees a subtask only when
    // they are assigned to that subtask, regardless of the parent's assignees. The same
    // where-builder applies; the caller adds any parentId filter separately.
    expect(taskScopeWhere({ role: "MEMBER", userId: "u-sub" })).toEqual({
      assignees: { some: { id: "u-sub" } },
    });
  });
});

describe("canSeeTask — single-row visibility predicate", () => {
  it("a CEO can see any task", () => {
    expect(
      canSeeTask({ role: "CEO", userId: "u-ceo" }, { assigneeIds: [] }),
    ).toBe(true);
    expect(
      canSeeTask({ role: "CEO", userId: "u-ceo" }, { assigneeIds: ["someone"] }),
    ).toBe(true);
  });

  it("a MEMBER can see a task they are assigned to", () => {
    expect(
      canSeeTask({ role: "MEMBER", userId: "u-1" }, { assigneeIds: ["u-1", "u-2"] }),
    ).toBe(true);
  });

  it("a MEMBER cannot see a task they are not assigned to", () => {
    expect(
      canSeeTask({ role: "MEMBER", userId: "u-1" }, { assigneeIds: ["u-2", "u-3"] }),
    ).toBe(false);
    expect(
      canSeeTask({ role: "MEMBER", userId: "u-1" }, { assigneeIds: [] }),
    ).toBe(false);
  });
});
