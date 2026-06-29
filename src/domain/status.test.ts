import { describe, it, expect } from "vitest";
import { isOverdue, isClosed, STATUSES } from "./status";

describe("status", () => {
  it("lists the four statuses in order", () => {
    expect(STATUSES).toEqual(["TODO", "IN_PROGRESS", "DONE", "REVIEWED"]);
  });

  it("DONE and REVIEWED are closed; TODO and IN_PROGRESS are not", () => {
    expect(isClosed("DONE")).toBe(true);
    expect(isClosed("REVIEWED")).toBe(true);
    expect(isClosed("TODO")).toBe(false);
    expect(isClosed("IN_PROGRESS")).toBe(false);
  });

  it("a task with no due date is never overdue", () => {
    expect(isOverdue({ status: "TODO", dueAt: null }, new Date("2026-06-29"))).toBe(false);
  });

  it("past due and open is overdue", () => {
    expect(
      isOverdue({ status: "TODO", dueAt: new Date("2020-01-01") }, new Date("2020-02-01")),
    ).toBe(true);
  });

  it("past due but closed is not overdue", () => {
    expect(
      isOverdue({ status: "DONE", dueAt: new Date("2020-01-01") }, new Date("2020-02-01")),
    ).toBe(false);
    expect(
      isOverdue({ status: "REVIEWED", dueAt: new Date("2020-01-01") }, new Date("2020-02-01")),
    ).toBe(false);
  });

  it("a future due date is not overdue", () => {
    expect(
      isOverdue({ status: "TODO", dueAt: new Date("2030-01-01") }, new Date("2020-02-01")),
    ).toBe(false);
  });
});
