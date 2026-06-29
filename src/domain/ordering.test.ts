import { describe, expect, it } from "vitest";
import {
  ORDER_STEP,
  appendOrder,
  midpoint,
  orderForMove,
  needsRenormalize,
  renormalize,
} from "./ordering";

describe("appendOrder — placing a new card at the end of a column", () => {
  it("returns ORDER_STEP for an empty column (no max)", () => {
    expect(appendOrder(null)).toBe(ORDER_STEP);
    expect(appendOrder(undefined)).toBe(ORDER_STEP);
  });

  it("returns max + ORDER_STEP when a max exists", () => {
    expect(appendOrder(0)).toBe(ORDER_STEP);
    expect(appendOrder(1000)).toBe(1000 + ORDER_STEP);
  });
});

describe("midpoint — fractional position between two neighbors", () => {
  it("returns the arithmetic mean of two orders", () => {
    expect(midpoint(0, 100)).toBe(50);
    expect(midpoint(100, 200)).toBe(150);
  });

  it("is symmetric and lands strictly between the neighbors", () => {
    const m = midpoint(10, 11);
    expect(m).toBeGreaterThan(10);
    expect(m).toBeLessThan(11);
  });
});

describe("orderForMove — target order from a list of neighbor orders + drop index", () => {
  // neighbors = the column's current orders in display order, EXCLUDING the moved card.
  const col = [100, 200, 300];

  it("drops at the top (index 0) => below the first neighbor", () => {
    const o = orderForMove(col, 0);
    expect(o).toBeLessThan(100);
  });

  it("drops in the middle (index 1) => between neighbor 0 and 1", () => {
    const o = orderForMove(col, 1);
    expect(o).toBeGreaterThan(100);
    expect(o).toBeLessThan(200);
  });

  it("drops at the end (index = length) => above the last neighbor", () => {
    const o = orderForMove(col, col.length);
    expect(o).toBeGreaterThan(300);
  });

  it("drops into an empty column => a positive starting order", () => {
    const o = orderForMove([], 0);
    expect(o).toBeGreaterThan(0);
  });

  it("clamps an out-of-range index to the end", () => {
    const o = orderForMove(col, 999);
    expect(o).toBeGreaterThan(300);
  });
});

describe("needsRenormalize — detecting collisions / no-gap neighbors", () => {
  it("flags when two adjacent orders are equal", () => {
    expect(needsRenormalize([1, 2, 2, 3])).toBe(true);
  });

  it("flags when the gap between neighbors is below the epsilon", () => {
    expect(needsRenormalize([0, 0.0000001])).toBe(true);
  });

  it("does not flag well-spaced orders", () => {
    expect(needsRenormalize([0, 100, 200])).toBe(false);
  });

  it("does not flag a single-item or empty column", () => {
    expect(needsRenormalize([])).toBe(false);
    expect(needsRenormalize([42])).toBe(false);
  });
});

describe("renormalize — evenly respacing a column's orders", () => {
  it("produces strictly increasing, evenly spaced orders", () => {
    const out = renormalize(5);
    expect(out).toEqual([
      ORDER_STEP,
      ORDER_STEP * 2,
      ORDER_STEP * 3,
      ORDER_STEP * 4,
      ORDER_STEP * 5,
    ]);
  });

  it("returns an empty array for an empty column", () => {
    expect(renormalize(0)).toEqual([]);
  });
});
