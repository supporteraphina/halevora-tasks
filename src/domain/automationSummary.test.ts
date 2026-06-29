import { describe, it, expect } from "vitest";
import {
  summarizeTrigger,
  summarizeCondition,
  summarizeAction,
  summarizeActions,
} from "./automationSummary";
import type { AutomationTrigger, Condition, Action } from "./automation";

describe("summarizeTrigger", () => {
  it("describes status_changed with a pinned destination", () => {
    const t: AutomationTrigger = {
      type: "status_changed",
      config: { to: "DONE" },
    };
    expect(summarizeTrigger(t)).toBe("When status changes to Done");
  });

  it("describes status_changed without a destination", () => {
    expect(summarizeTrigger({ type: "status_changed", config: {} })).toBe(
      "When status changes",
    );
  });

  it("describes priority_changed with a pinned priority", () => {
    expect(
      summarizeTrigger({ type: "priority_changed", config: { to: "URGENT" } }),
    ).toBe("When priority changes to Urgent");
  });

  it("describes assignee/due/tag triggers", () => {
    expect(summarizeTrigger({ type: "assignee_changed", config: {} })).toBe(
      "When the assignee changes",
    );
    expect(summarizeTrigger({ type: "due_changed", config: {} })).toBe(
      "When the due date changes",
    );
    expect(
      summarizeTrigger({ type: "tag_added", config: { tag: "shipped" } }),
    ).toBe('When the tag "shipped" is added');
    expect(summarizeTrigger({ type: "tag_added", config: {} })).toBe(
      "When any tag is added",
    );
  });

  it("describes the scheduled trigger with cadence and interval", () => {
    expect(
      summarizeTrigger({ type: "scheduled", config: { cadence: "DAILY", interval: 1 } }),
    ).toBe("Every day");
    expect(
      summarizeTrigger({ type: "scheduled", config: { cadence: "WEEKLY", interval: 2 } }),
    ).toBe("Every 2 weeks");
  });

  it("returns a safe fallback for an unknown trigger shape", () => {
    // @ts-expect-error — deliberately malformed
    expect(summarizeTrigger({ type: "nope", config: {} })).toBe(
      "When something changes",
    );
    // @ts-expect-error — deliberately malformed
    expect(summarizeTrigger(null)).toBe("When something changes");
  });
});

describe("summarizeCondition", () => {
  it("renders a scalar comparison with friendly value labels", () => {
    const c: Condition = { field: "priority", operator: "equals", value: "URGENT" };
    expect(summarizeCondition(c)).toBe("Priority is Urgent");
  });

  it("renders a status comparison with a friendly label", () => {
    const c: Condition = { field: "status", operator: "not_equals", value: "DONE" };
    expect(summarizeCondition(c)).toBe("Status is not Done");
  });

  it("renders an emptiness check without a value", () => {
    const c: Condition = { field: "assignees", operator: "is_empty" };
    expect(summarizeCondition(c)).toBe("Assignees is empty");
  });

  it("renders a raw text contains", () => {
    const c: Condition = { field: "title", operator: "contains", value: "launch" };
    expect(summarizeCondition(c)).toBe("Title contains launch");
  });
});

describe("summarizeAction / summarizeActions", () => {
  it("renders each action type", () => {
    expect(summarizeAction({ type: "set_status", status: "DONE" })).toBe(
      "Set status to Done",
    );
    expect(summarizeAction({ type: "set_priority", priority: "HIGH" })).toBe(
      "Set priority to High",
    );
    expect(summarizeAction({ type: "add_tag", tag: "shipped" })).toBe(
      'Add tag "shipped"',
    );
    expect(summarizeAction({ type: "remove_tag", tag: "blocked" })).toBe(
      'Remove tag "blocked"',
    );
    expect(summarizeAction({ type: "post_comment", text: "hi" })).toBe(
      "Post a comment",
    );
    expect(summarizeAction({ type: "assign_user", userId: "u1" })).toBe(
      "Assign a person",
    );
  });

  it("joins an action list with 'then'", () => {
    const actions: Action[] = [
      { type: "set_status", status: "DONE" },
      { type: "add_tag", tag: "shipped" },
    ];
    expect(summarizeActions(actions)).toBe(
      'Set status to Done, then Add tag "shipped"',
    );
  });

  it("returns an empty string for no actions", () => {
    expect(summarizeActions([])).toBe("");
  });
});
