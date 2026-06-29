import { describe, expect, it } from "vitest";
import {
  STATUS_GROUPS,
  STATUS_LABELS,
  badgeFor,
} from "./statusGroups";

describe("STATUS_GROUPS — the grouped status dropdown (ClickUp parity)", () => {
  it("groups the four stored statuses as Not started / Active / Done / Closed", () => {
    expect(STATUS_GROUPS.map((g) => g.label)).toEqual([
      "Not started",
      "Active",
      "Done",
      "Closed",
    ]);
  });

  it("maps each group to the correct stored status", () => {
    const byLabel = Object.fromEntries(
      STATUS_GROUPS.map((g) => [g.label, g.statuses]),
    );
    expect(byLabel["Not started"]).toEqual(["TODO"]);
    expect(byLabel["Active"]).toEqual(["IN_PROGRESS"]);
    expect(byLabel["Done"]).toEqual(["DONE"]);
    expect(byLabel["Closed"]).toEqual(["REVIEWED"]);
  });

  it("only ever offers the four stored statuses (OVERDUE is never selectable)", () => {
    const all = STATUS_GROUPS.flatMap((g) => g.statuses);
    expect(all).toEqual(["TODO", "IN_PROGRESS", "DONE", "REVIEWED"]);
    expect(all).not.toContain("OVERDUE");
  });
});

describe("STATUS_LABELS — display text for each stored status", () => {
  it("renders human badge text", () => {
    expect(STATUS_LABELS.TODO).toBe("TO DO");
    expect(STATUS_LABELS.IN_PROGRESS).toBe("IN PROGRESS");
    expect(STATUS_LABELS.DONE).toBe("DONE");
    expect(STATUS_LABELS.REVIEWED).toBe("REVIEWED");
  });
});

describe("badgeFor — the badge shown on a card (OVERDUE is derived, never stored)", () => {
  const now = new Date("2026-06-29T12:00:00Z");
  const past = new Date("2026-06-28T12:00:00Z");
  const future = new Date("2026-06-30T12:00:00Z");

  it("shows OVERDUE for an open task past its due date", () => {
    expect(badgeFor({ status: "TODO", dueAt: past }, now)).toEqual({
      key: "OVERDUE",
      label: "OVERDUE",
    });
    expect(badgeFor({ status: "IN_PROGRESS", dueAt: past }, now)).toEqual({
      key: "OVERDUE",
      label: "OVERDUE",
    });
  });

  it("shows the stored status when not overdue", () => {
    expect(badgeFor({ status: "TODO", dueAt: future }, now)).toEqual({
      key: "TODO",
      label: "TO DO",
    });
    expect(badgeFor({ status: "TODO", dueAt: null }, now)).toEqual({
      key: "TODO",
      label: "TO DO",
    });
  });

  it("never shows OVERDUE for a closed task even if past due", () => {
    expect(badgeFor({ status: "DONE", dueAt: past }, now)).toEqual({
      key: "DONE",
      label: "DONE",
    });
    expect(badgeFor({ status: "REVIEWED", dueAt: past }, now)).toEqual({
      key: "REVIEWED",
      label: "REVIEWED",
    });
  });
});
