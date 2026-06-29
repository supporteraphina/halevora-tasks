import { describe, it, expect } from "vitest";
import {
  wouldCreateCycle,
  validateNewDependency,
  openBlockerCount,
} from "./dependencies";

/**
 * A directed edge `blocker -> blocked`: the blocker must close before the blocked
 * task may be marked Done. Adding an edge must never introduce a cycle (which would
 * make a task transitively block itself — an unsatisfiable state).
 */

describe("wouldCreateCycle — DFS over the directed blocker->blocked graph", () => {
  it("a self-edge is a cycle", () => {
    expect(wouldCreateCycle([], { blockerId: "a", blockedId: "a" })).toBe(true);
  });

  it("an edge into an empty graph is never a cycle", () => {
    expect(wouldCreateCycle([], { blockerId: "a", blockedId: "b" })).toBe(false);
  });

  it("a direct back-edge is a cycle (a->b then b->a)", () => {
    const edges = [{ blockerId: "a", blockedId: "b" }];
    // b blocking a would close the loop a->b->a.
    expect(wouldCreateCycle(edges, { blockerId: "b", blockedId: "a" })).toBe(true);
  });

  it("a transitive / multi-hop back-edge is a cycle (a->b->c then c->a)", () => {
    const edges = [
      { blockerId: "a", blockedId: "b" },
      { blockerId: "b", blockedId: "c" },
    ];
    expect(wouldCreateCycle(edges, { blockerId: "c", blockedId: "a" })).toBe(true);
  });

  it("a longer multi-hop back-edge is a cycle (a->b->c->d then d->a)", () => {
    const edges = [
      { blockerId: "a", blockedId: "b" },
      { blockerId: "b", blockedId: "c" },
      { blockerId: "c", blockedId: "d" },
    ];
    expect(wouldCreateCycle(edges, { blockerId: "d", blockedId: "a" })).toBe(true);
  });

  it("a diamond is NOT a cycle (a->b, a->c, b->d, c->d)", () => {
    const edges = [
      { blockerId: "a", blockedId: "b" },
      { blockerId: "a", blockedId: "c" },
      { blockerId: "b", blockedId: "d" },
    ];
    // c->d completes the diamond; both paths converge, no back-edge.
    expect(wouldCreateCycle(edges, { blockerId: "c", blockedId: "d" })).toBe(false);
  });

  it("a forward (parallel) edge that does not loop back is NOT a cycle", () => {
    const edges = [
      { blockerId: "a", blockedId: "b" },
      { blockerId: "b", blockedId: "c" },
    ];
    // a->c is a shortcut, not a loop.
    expect(wouldCreateCycle(edges, { blockerId: "a", blockedId: "c" })).toBe(false);
  });

  it("ignores disconnected components when judging a new edge", () => {
    const edges = [
      { blockerId: "x", blockedId: "y" }, // unrelated component
      { blockerId: "a", blockedId: "b" },
    ];
    expect(wouldCreateCycle(edges, { blockerId: "b", blockedId: "c" })).toBe(false);
  });

  it("a duplicate of an existing edge is not itself a cycle (caught separately)", () => {
    const edges = [{ blockerId: "a", blockedId: "b" }];
    expect(wouldCreateCycle(edges, { blockerId: "a", blockedId: "b" })).toBe(false);
  });
});

describe("validateNewDependency — the single server-side gate", () => {
  it("rejects a self-edge", () => {
    const r = validateNewDependency([], { blockerId: "a", blockedId: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/itself/i);
  });

  it("rejects a duplicate edge", () => {
    const edges = [{ blockerId: "a", blockedId: "b" }];
    const r = validateNewDependency(edges, { blockerId: "a", blockedId: "b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already/i);
  });

  it("rejects an edge that would create a cycle", () => {
    const edges = [
      { blockerId: "a", blockedId: "b" },
      { blockerId: "b", blockedId: "c" },
    ];
    const r = validateNewDependency(edges, { blockerId: "c", blockedId: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/circular|cycle/i);
  });

  it("accepts a valid new edge", () => {
    const edges = [{ blockerId: "a", blockedId: "b" }];
    const r = validateNewDependency(edges, { blockerId: "b", blockedId: "c" });
    expect(r.ok).toBe(true);
  });

  it("treats the reverse of an existing edge as a cycle, not a duplicate", () => {
    const edges = [{ blockerId: "a", blockedId: "b" }];
    const r = validateNewDependency(edges, { blockerId: "b", blockedId: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/circular|cycle/i);
  });
});

describe("openBlockerCount — how many blockers are still open", () => {
  it("counts blockers whose status is not closed", () => {
    expect(
      openBlockerCount([
        { status: "TODO" },
        { status: "IN_PROGRESS" },
        { status: "DONE" },
        { status: "REVIEWED" },
      ]),
    ).toBe(2);
  });

  it("is zero when there are no blockers", () => {
    expect(openBlockerCount([])).toBe(0);
  });

  it("is zero when every blocker is closed", () => {
    expect(openBlockerCount([{ status: "DONE" }, { status: "REVIEWED" }])).toBe(0);
  });
});
