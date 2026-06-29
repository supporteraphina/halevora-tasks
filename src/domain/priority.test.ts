import { describe, expect, it } from "vitest";
import { PRIORITIES, Priority, comparePriority, priorityRank } from "./priority.js";

describe("priority domain", () => {
  it("lists all four priorities, most urgent first", () => {
    expect(PRIORITIES).toEqual(["URGENT", "HIGH", "NORMAL", "LOW"]);
  });

  it("ranks URGENT below NORMAL numerically (lower rank = more urgent)", () => {
    expect(priorityRank("URGENT")).toBeLessThan(priorityRank("NORMAL"));
    expect(priorityRank("HIGH")).toBeLessThan(priorityRank("LOW"));
  });

  it("comparePriority sorts most urgent first", () => {
    const shuffled: Priority[] = ["LOW", "URGENT", "NORMAL", "HIGH"];
    expect([...shuffled].sort(comparePriority)).toEqual([
      "URGENT",
      "HIGH",
      "NORMAL",
      "LOW",
    ]);
  });
});
