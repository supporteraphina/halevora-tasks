import { describe, it, expect } from "vitest";
import {
  parseTimeEstimate,
  formatTimeEstimate,
  normalizeTagName,
} from "./taskDetail";

describe("parseTimeEstimate", () => {
  it("parses a positive integer number of minutes", () => {
    expect(parseTimeEstimate("90")).toEqual({ ok: true, value: 90 });
  });

  it("treats empty input as clearing the estimate (null)", () => {
    expect(parseTimeEstimate("")).toEqual({ ok: true, value: null });
    expect(parseTimeEstimate("   ")).toEqual({ ok: true, value: null });
  });

  it("rejects non-numeric input", () => {
    expect(parseTimeEstimate("soon").ok).toBe(false);
  });

  it("rejects negative or fractional minutes", () => {
    expect(parseTimeEstimate("-5").ok).toBe(false);
    expect(parseTimeEstimate("1.5").ok).toBe(false);
  });

  it("rejects an absurdly large estimate", () => {
    expect(parseTimeEstimate("100000000").ok).toBe(false);
  });

  it("accepts zero as clearing-equivalent null", () => {
    expect(parseTimeEstimate("0")).toEqual({ ok: true, value: null });
  });
});

describe("formatTimeEstimate", () => {
  it("renders null as an em-dash placeholder", () => {
    expect(formatTimeEstimate(null)).toBe("—");
  });

  it("renders minutes under an hour as Nm", () => {
    expect(formatTimeEstimate(45)).toBe("45m");
  });

  it("renders whole hours as Nh", () => {
    expect(formatTimeEstimate(120)).toBe("2h");
  });

  it("renders mixed hours and minutes", () => {
    expect(formatTimeEstimate(90)).toBe("1h 30m");
  });
});

describe("normalizeTagName", () => {
  it("trims and lowercases", () => {
    expect(normalizeTagName("  Design  ")).toBe("design");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeTagName("high   priority")).toBe("high priority");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeTagName("   ")).toBe("");
  });
});
