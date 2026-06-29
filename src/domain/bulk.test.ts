import { describe, expect, it } from "vitest";
import {
  parseTaskIds,
  isBulkStatusOp,
  isBulkPriorityOp,
  parseBulkResult,
  summarizeBulk,
  MAX_BULK_IDS,
} from "./bulk";

describe("parseTaskIds — defensive id-list parse", () => {
  it("accepts a clean array of non-empty strings, de-duplicated", () => {
    expect(parseTaskIds(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("drops non-strings, blanks, and over-long ids", () => {
    expect(parseTaskIds(["a", "", "  ", 5, null, "b"])).toEqual(["a", "b"]);
  });

  it("returns [] for non-array input (never throws)", () => {
    for (const bad of [null, undefined, "a", 1, {}]) {
      expect(parseTaskIds(bad)).toEqual([]);
    }
  });

  it("caps the list length to bound batch cost", () => {
    const many = Array.from({ length: MAX_BULK_IDS + 50 }, (_, i) => `t${i}`);
    expect(parseTaskIds(many).length).toBe(MAX_BULK_IDS);
  });

  it("parses a JSON string array too", () => {
    expect(parseTaskIds('["a","b"]')).toEqual(["a", "b"]);
    expect(parseTaskIds("not json")).toEqual([]);
  });
});

describe("op guards", () => {
  it("validates stored statuses (never OVERDUE)", () => {
    expect(isBulkStatusOp("TODO")).toBe(true);
    expect(isBulkStatusOp("REVIEWED")).toBe(true);
    expect(isBulkStatusOp("OVERDUE")).toBe(false);
    expect(isBulkStatusOp("nope")).toBe(false);
  });

  it("validates priorities", () => {
    expect(isBulkPriorityOp("URGENT")).toBe(true);
    expect(isBulkPriorityOp("NORMAL")).toBe(true);
    expect(isBulkPriorityOp("nope")).toBe(false);
  });
});

describe("bulk result accounting", () => {
  it("summarizes updated / skipped / blocked counts into a message", () => {
    expect(summarizeBulk({ updated: 3, skipped: 0, blocked: 0 })).toMatch(/3/);
    const msg = summarizeBulk({ updated: 2, skipped: 1, blocked: 1 });
    expect(msg).toMatch(/2/);
    expect(msg).toMatch(/skip|couldn|blocked/i);
  });

  it("parseBulkResult fills defaults defensively", () => {
    expect(parseBulkResult({ updated: 2 })).toEqual({
      updated: 2,
      skipped: 0,
      blocked: 0,
    });
    expect(parseBulkResult(null)).toEqual({ updated: 0, skipped: 0, blocked: 0 });
  });
});
