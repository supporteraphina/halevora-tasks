import { describe, it, expect } from "vitest";
import { moveTargets, moveTargetLabel, type BoardRef } from "./moveTargets";

const BOARDS: BoardRef[] = [
  { id: "b1", name: "Innovations", cardCount: 3 },
  { id: "b2", name: "Client success", cardCount: 0 },
  { id: "b3", name: "Meta Ads", cardCount: 5 },
];

describe("moveTargets", () => {
  it("offers a top and a bottom target for every board", () => {
    const targets = moveTargets(BOARDS, "b1", "card-x");
    expect(targets).toHaveLength(6);
    const names = targets.map((t) => `${t.boardName}/${t.position}`);
    expect(names).toEqual([
      "Innovations/top",
      "Innovations/bottom",
      "Client success/top",
      "Client success/bottom",
      "Meta Ads/top",
      "Meta Ads/bottom",
    ]);
  });

  it("top target is always index 0", () => {
    const targets = moveTargets(BOARDS, "b1", "card-x");
    for (const t of targets.filter((x) => x.position === "top")) {
      expect(t.index).toBe(0);
    }
  });

  it("bottom of a DIFFERENT board uses the full card count", () => {
    const targets = moveTargets(BOARDS, "b1", "card-x");
    const metaBottom = targets.find(
      (t) => t.boardId === "b3" && t.position === "bottom",
    )!;
    expect(metaBottom.index).toBe(5);
  });

  it("bottom of the SAME board discounts the moving card (count - 1)", () => {
    const targets = moveTargets(BOARDS, "b1", "card-x");
    const ownBottom = targets.find(
      (t) => t.boardId === "b1" && t.position === "bottom",
    )!;
    // Innovations has 3 visible cards incl. the mover -> 2 real neighbours -> index 2.
    expect(ownBottom.index).toBe(2);
  });

  it("never produces a negative index for an empty same-board edge case", () => {
    const empty: BoardRef[] = [{ id: "b1", name: "Empty", cardCount: 0 }];
    const targets = moveTargets(empty, "b1", "card-x");
    expect(targets.every((t) => t.index >= 0)).toBe(true);
  });

  it("bottom of an empty different board is index 0", () => {
    const targets = moveTargets(BOARDS, "b1", "card-x");
    const clientBottom = targets.find(
      (t) => t.boardId === "b2" && t.position === "bottom",
    )!;
    expect(clientBottom.index).toBe(0);
  });

  it("labels read as 'Name — position'", () => {
    const targets = moveTargets(BOARDS, "b1", "card-x");
    expect(moveTargetLabel(targets[0])).toBe("Innovations — top");
    expect(moveTargetLabel(targets[5])).toBe("Meta Ads — bottom");
  });
});
