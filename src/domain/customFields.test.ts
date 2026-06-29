import { describe, it, expect } from "vitest";
import {
  CUSTOM_FIELD_TYPES,
  parseFieldConfig,
  parseFieldValue,
  formatFieldValue,
  type CustomFieldKind,
} from "./customFields";

describe("CUSTOM_FIELD_TYPES", () => {
  it("lists exactly the nine v1 field kinds", () => {
    expect(CUSTOM_FIELD_TYPES).toEqual([
      "TEXT",
      "NUMBER",
      "CHECKBOX",
      "DATE",
      "DROPDOWN",
      "LABELS",
      "RATING",
      "PEOPLE",
      "SLIDER",
    ]);
  });
});

describe("parseFieldConfig", () => {
  it("reads dropdown / labels options as a clean string list", () => {
    const cfg = parseFieldConfig("DROPDOWN", {
      options: [
        { id: "a", label: "Low" },
        { id: "b", label: "High" },
      ],
    });
    expect(cfg.options).toEqual([
      { id: "a", label: "Low" },
      { id: "b", label: "High" },
    ]);
  });

  it("defaults a missing options list to empty", () => {
    const cfg = parseFieldConfig("LABELS", null);
    expect(cfg.options).toEqual([]);
  });

  it("clamps a rating max into 1..10, defaulting to 5", () => {
    expect(parseFieldConfig("RATING", { max: 3 }).max).toBe(3);
    expect(parseFieldConfig("RATING", null).max).toBe(5);
    expect(parseFieldConfig("RATING", { max: 0 }).max).toBe(5);
    expect(parseFieldConfig("RATING", { max: 99 }).max).toBe(10);
  });

  it("reads slider min/max with sane defaults (0..100)", () => {
    expect(parseFieldConfig("SLIDER", null)).toMatchObject({ min: 0, max: 100 });
    expect(parseFieldConfig("SLIDER", { min: 0, max: 50 })).toMatchObject({
      min: 0,
      max: 50,
    });
  });

  it("falls back to 0..100 when slider min >= max", () => {
    expect(parseFieldConfig("SLIDER", { min: 80, max: 20 })).toMatchObject({
      min: 0,
      max: 100,
    });
  });
});

describe("parseFieldValue", () => {
  // ---- TEXT ----
  it("TEXT: trims and accepts a string, clears on empty", () => {
    expect(parseFieldValue("TEXT", null, "  hello  ")).toEqual({
      ok: true,
      value: "hello",
    });
    expect(parseFieldValue("TEXT", null, "   ")).toEqual({ ok: true, value: null });
  });

  it("TEXT: rejects an over-long string", () => {
    const long = "x".repeat(5001);
    expect(parseFieldValue("TEXT", null, long).ok).toBe(false);
  });

  // ---- NUMBER ----
  it("NUMBER: parses a finite number, clears on empty", () => {
    expect(parseFieldValue("NUMBER", null, "42")).toEqual({ ok: true, value: 42 });
    expect(parseFieldValue("NUMBER", null, "-3.5")).toEqual({ ok: true, value: -3.5 });
    expect(parseFieldValue("NUMBER", null, "")).toEqual({ ok: true, value: null });
  });

  it("NUMBER: rejects non-numeric input", () => {
    expect(parseFieldValue("NUMBER", null, "abc").ok).toBe(false);
    expect(parseFieldValue("NUMBER", null, "Infinity").ok).toBe(false);
  });

  // ---- CHECKBOX ----
  it("CHECKBOX: coerces truthy strings to a boolean", () => {
    expect(parseFieldValue("CHECKBOX", null, "true")).toEqual({ ok: true, value: true });
    expect(parseFieldValue("CHECKBOX", null, "false")).toEqual({
      ok: true,
      value: false,
    });
    expect(parseFieldValue("CHECKBOX", null, "")).toEqual({ ok: true, value: false });
  });

  // ---- DATE ----
  it("DATE: accepts an ISO date string, clears on empty", () => {
    expect(parseFieldValue("DATE", null, "2026-07-01")).toEqual({
      ok: true,
      value: "2026-07-01",
    });
    expect(parseFieldValue("DATE", null, "")).toEqual({ ok: true, value: null });
  });

  it("DATE: rejects a malformed date", () => {
    expect(parseFieldValue("DATE", null, "not-a-date").ok).toBe(false);
    expect(parseFieldValue("DATE", null, "2026-13-99").ok).toBe(false);
  });

  // ---- DROPDOWN ----
  const dropdownCfg = {
    options: [
      { id: "a", label: "Low" },
      { id: "b", label: "High" },
    ],
  };
  it("DROPDOWN: accepts only a configured option id, clears on empty", () => {
    expect(parseFieldValue("DROPDOWN", dropdownCfg, "a")).toEqual({
      ok: true,
      value: "a",
    });
    expect(parseFieldValue("DROPDOWN", dropdownCfg, "")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("DROPDOWN: rejects an unknown option id", () => {
    expect(parseFieldValue("DROPDOWN", dropdownCfg, "zzz").ok).toBe(false);
  });

  // ---- LABELS (multi-select) ----
  it("LABELS: accepts a subset of configured ids (JSON array)", () => {
    expect(parseFieldValue("LABELS", dropdownCfg, JSON.stringify(["a", "b"]))).toEqual({
      ok: true,
      value: ["a", "b"],
    });
    expect(parseFieldValue("LABELS", dropdownCfg, JSON.stringify([]))).toEqual({
      ok: true,
      value: null,
    });
  });

  it("LABELS: rejects an id that is not a configured option", () => {
    expect(parseFieldValue("LABELS", dropdownCfg, JSON.stringify(["a", "x"])).ok).toBe(
      false,
    );
  });

  // ---- RATING ----
  it("RATING: accepts 0..max, clears on 0", () => {
    const cfg = { max: 5 };
    expect(parseFieldValue("RATING", cfg, "3")).toEqual({ ok: true, value: 3 });
    expect(parseFieldValue("RATING", cfg, "0")).toEqual({ ok: true, value: null });
  });

  it("RATING: rejects above max or non-integer", () => {
    const cfg = { max: 5 };
    expect(parseFieldValue("RATING", cfg, "6").ok).toBe(false);
    expect(parseFieldValue("RATING", cfg, "2.5").ok).toBe(false);
  });

  // ---- PEOPLE ----
  it("PEOPLE: accepts a JSON array of user ids, clears on empty", () => {
    expect(parseFieldValue("PEOPLE", null, JSON.stringify(["u1", "u2"]))).toEqual({
      ok: true,
      value: ["u1", "u2"],
    });
    expect(parseFieldValue("PEOPLE", null, JSON.stringify([]))).toEqual({
      ok: true,
      value: null,
    });
  });

  it("PEOPLE: de-duplicates ids and rejects non-string entries", () => {
    expect(parseFieldValue("PEOPLE", null, JSON.stringify(["u1", "u1"]))).toEqual({
      ok: true,
      value: ["u1"],
    });
    expect(parseFieldValue("PEOPLE", null, JSON.stringify(["u1", 7])).ok).toBe(false);
  });

  // ---- SLIDER ----
  it("SLIDER: accepts a value within min..max", () => {
    const cfg = { min: 0, max: 100 };
    expect(parseFieldValue("SLIDER", cfg, "60")).toEqual({ ok: true, value: 60 });
    expect(parseFieldValue("SLIDER", cfg, "")).toEqual({ ok: true, value: null });
  });

  it("SLIDER: rejects a value out of range", () => {
    const cfg = { min: 0, max: 100 };
    expect(parseFieldValue("SLIDER", cfg, "120").ok).toBe(false);
    expect(parseFieldValue("SLIDER", cfg, "-1").ok).toBe(false);
  });
});

describe("formatFieldValue", () => {
  const dropdownCfg = parseFieldConfig("DROPDOWN", {
    options: [
      { id: "a", label: "Low" },
      { id: "b", label: "High" },
    ],
  });

  it("renders an unset value as an em-dash", () => {
    expect(formatFieldValue("TEXT", null, null)).toBe("—");
    expect(formatFieldValue("NUMBER", null, null)).toBe("—");
  });

  it("renders a checkbox as Yes/No", () => {
    expect(formatFieldValue("CHECKBOX", null, true)).toBe("Yes");
    expect(formatFieldValue("CHECKBOX", null, false)).toBe("No");
  });

  it("renders a dropdown value by its label", () => {
    expect(formatFieldValue("DROPDOWN", dropdownCfg, "b")).toBe("High");
  });

  it("renders labels as a comma list of their labels", () => {
    expect(formatFieldValue("LABELS", dropdownCfg, ["a", "b"])).toBe("Low, High");
  });

  it("renders a rating as filled/empty count", () => {
    const cfg = parseFieldConfig("RATING", { max: 5 });
    expect(formatFieldValue("RATING", cfg, 3)).toBe("3/5");
  });

  it("renders a slider as a percent-style value", () => {
    const cfg = parseFieldConfig("SLIDER", { min: 0, max: 100 });
    expect(formatFieldValue("SLIDER", cfg, 60)).toBe("60%");
  });
});

describe("type guard", () => {
  it("each kind is a valid CustomFieldKind", () => {
    const kinds: CustomFieldKind[] = [...CUSTOM_FIELD_TYPES];
    expect(kinds.length).toBe(9);
  });
});
