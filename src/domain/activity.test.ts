import { describe, it, expect } from "vitest";
import {
  ACTIVITY_TYPES,
  describeActivity,
  type ActivityType,
} from "./activity";

describe("ACTIVITY_TYPES", () => {
  it("includes the §4 + §5 mutation kinds", () => {
    const expected: ActivityType[] = [
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
    ];
    for (const t of expected) expect(ACTIVITY_TYPES).toContain(t);
  });
});

describe("describeActivity", () => {
  it("renders a status change with from/to", () => {
    expect(
      describeActivity("status_changed", { from: "TODO", to: "DONE" }),
    ).toBe("changed status from To Do to Done");
  });

  it("renders a priority change", () => {
    expect(
      describeActivity("priority_changed", { from: "NORMAL", to: "URGENT" }),
    ).toBe("changed priority from Normal to Urgent");
  });

  it("renders assignee add/remove with a name", () => {
    expect(describeActivity("assignee_added", { name: "Noel" })).toBe(
      "assigned Noel",
    );
    expect(describeActivity("assignee_removed", { name: "Noel" })).toBe(
      "unassigned Noel",
    );
  });

  it("renders a due-date change set vs cleared", () => {
    expect(describeActivity("due_changed", { to: "Jul 1, 2026" })).toBe(
      "set the due date to Jul 1, 2026",
    );
    expect(describeActivity("due_changed", { to: null })).toBe(
      "cleared the due date",
    );
  });

  it("renders a comment and attachment events", () => {
    expect(describeActivity("comment_created", {})).toBe("commented");
    expect(describeActivity("attachment_added", { filename: "spec.pdf" })).toBe(
      "attached spec.pdf",
    );
    expect(
      describeActivity("attachment_removed", { filename: "spec.pdf" }),
    ).toBe("removed attachment spec.pdf");
  });

  it("renders a custom-field set with the field name", () => {
    expect(
      describeActivity("custom_field_set", { field: "Budget" }),
    ).toBe("updated Budget");
  });

  it("renders dependency add/remove with direction and the other task's title", () => {
    expect(
      describeActivity("dependency_added", {
        direction: "waiting_on",
        title: "Design",
      }),
    ).toBe('added a "waiting on" link to Design');
    expect(
      describeActivity("dependency_added", {
        direction: "blocking",
        title: "Ship",
      }),
    ).toBe('added a "blocking" link to Ship');
    expect(
      describeActivity("dependency_removed", { title: "Design" }),
    ).toBe("removed a dependency link to Design");
  });

  it("falls back to a readable label for an unknown payload", () => {
    expect(describeActivity("status_changed", {})).toBe("changed status");
  });
});
