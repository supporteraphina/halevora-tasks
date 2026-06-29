import { describe, it, expect } from "vitest";
import {
  QUICK_CHOICES,
  quickChoiceDate,
  formatInZone,
  dateInputValue,
  parseDateInput,
  isSameDayInZone,
  type QuickChoice,
} from "./dates";

/**
 * The reference "now" for these tests: 2026-06-29T08:00:00Z.
 * In UTC that is Monday 2026-06-29 08:00.
 * In Asia/Jerusalem (UTC+3 in summer) that is Monday 2026-06-29 11:00.
 * The quick-choice anchor is the actor's LOCAL calendar day, and the produced
 * Date marks midnight (00:00) of the chosen local day, expressed as a UTC instant.
 */
const NOW = new Date("2026-06-29T08:00:00Z");

describe("QUICK_CHOICES", () => {
  it("lists the six ClickUp quick choices in order", () => {
    expect(QUICK_CHOICES.map((c) => c.key)).toEqual([
      "today",
      "tomorrow",
      "this_weekend",
      "next_week",
      "two_weeks",
      "four_weeks",
    ]);
  });

  it("every quick choice has a human label", () => {
    for (const c of QUICK_CHOICES) {
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});

describe("quickChoiceDate (UTC actor)", () => {
  const tz = "UTC";

  function ymd(key: QuickChoice): string {
    return dateInputValue(quickChoiceDate(key, NOW, tz), tz);
  }

  it("today = the actor's local calendar day", () => {
    expect(ymd("today")).toBe("2026-06-29");
  });

  it("tomorrow = local day + 1", () => {
    expect(ymd("tomorrow")).toBe("2026-06-30");
  });

  it("this weekend = the upcoming Saturday", () => {
    // 2026-06-29 is a Monday; the coming Saturday is 2026-07-04.
    expect(ymd("this_weekend")).toBe("2026-07-04");
  });

  it("next week = the upcoming Monday", () => {
    // From Monday 06-29, next Monday is 07-06.
    expect(ymd("next_week")).toBe("2026-07-06");
  });

  it("two weeks = local day + 14", () => {
    expect(ymd("two_weeks")).toBe("2026-07-13");
  });

  it("four weeks = local day + 28", () => {
    expect(ymd("four_weeks")).toBe("2026-07-27");
  });

  it("the produced instant is midnight of the local day", () => {
    const d = quickChoiceDate("today", NOW, tz);
    expect(d.toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });
});

describe("quickChoiceDate (Asia/Jerusalem actor, UTC+3 in summer)", () => {
  const tz = "Asia/Jerusalem";

  function ymd(key: QuickChoice): string {
    return dateInputValue(quickChoiceDate(key, NOW, tz), tz);
  }

  it("today reflects the local Jerusalem day, not the UTC day", () => {
    // At 08:00Z it is already 11:00 in Jerusalem -> same calendar day here.
    expect(ymd("today")).toBe("2026-06-29");
  });

  it("midnight Jerusalem maps back to 21:00 UTC the previous day", () => {
    // 2026-06-29 00:00 in Jerusalem (UTC+3) == 2026-06-28 21:00 UTC.
    const d = quickChoiceDate("today", NOW, tz);
    expect(d.toISOString()).toBe("2026-06-28T21:00:00.000Z");
  });

  it("tomorrow is the next local day", () => {
    expect(ymd("tomorrow")).toBe("2026-06-30");
  });
});

describe("this weekend / next week from a Saturday", () => {
  // Saturday 2026-07-04T08:00:00Z.
  const SAT = new Date("2026-07-04T08:00:00Z");
  const tz = "UTC";

  it("this weekend on a Saturday stays on that Saturday", () => {
    expect(dateInputValue(quickChoiceDate("this_weekend", SAT, tz), tz)).toBe(
      "2026-07-04",
    );
  });

  it("next week on a Saturday is the following Monday", () => {
    expect(dateInputValue(quickChoiceDate("next_week", SAT, tz), tz)).toBe(
      "2026-07-06",
    );
  });
});

describe("formatInZone", () => {
  it("renders a UTC instant in the actor's timezone", () => {
    const d = new Date("2026-06-28T21:00:00Z"); // midnight Jerusalem
    expect(formatInZone(d, "Asia/Jerusalem")).toBe("Jun 29, 2026");
  });

  it("renders the same instant differently in UTC", () => {
    const d = new Date("2026-06-28T21:00:00Z");
    expect(formatInZone(d, "UTC")).toBe("Jun 28, 2026");
  });
});

describe("dateInputValue / parseDateInput round-trip", () => {
  it("parseDateInput interprets a YYYY-MM-DD as local midnight in the zone", () => {
    const d = parseDateInput("2026-06-29", "Asia/Jerusalem");
    expect(d?.toISOString()).toBe("2026-06-28T21:00:00.000Z");
  });

  it("round-trips through dateInputValue", () => {
    const d = parseDateInput("2026-07-15", "Asia/Jerusalem");
    expect(d).not.toBeNull();
    expect(dateInputValue(d as Date, "Asia/Jerusalem")).toBe("2026-07-15");
  });

  it("returns null for empty or malformed input", () => {
    expect(parseDateInput("", "UTC")).toBeNull();
    expect(parseDateInput("not-a-date", "UTC")).toBeNull();
    expect(parseDateInput("2026-13-40", "UTC")).toBeNull();
  });
});

describe("isSameDayInZone — Today bucketing in the actor's timezone", () => {
  it("two instants on the same local day match", () => {
    const a = new Date("2026-06-29T08:00:00Z");
    const b = new Date("2026-06-29T20:00:00Z");
    expect(isSameDayInZone(a, b, "UTC")).toBe(true);
  });

  it("differs across midnight in UTC", () => {
    const a = new Date("2026-06-29T23:00:00Z");
    const b = new Date("2026-06-30T01:00:00Z");
    expect(isSameDayInZone(a, b, "UTC")).toBe(false);
  });

  it("respects the zone: a late-evening local due lands on the local day, not UTC's", () => {
    // 2026-06-29T22:00Z is already 2026-06-30 01:00 in Asia/Jerusalem (+3 summer).
    const due = new Date("2026-06-29T22:00:00Z");
    const now = new Date("2026-06-30T06:00:00Z"); // 09:00 local on Jun 30
    expect(isSameDayInZone(due, now, "Asia/Jerusalem")).toBe(true);
    expect(isSameDayInZone(due, now, "UTC")).toBe(false);
  });
});
