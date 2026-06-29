import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayKey,
  monthGrid,
  periodLabel,
  startOfWeek,
  stepAnchor,
  weekdayOf,
  weekGrid,
  type CalDay,
} from "./calendar";

const JUN29: CalDay = { year: 2026, month: 6, day: 29 }; // a Monday

describe("dayKey", () => {
  it("zero-pads month and day", () => {
    expect(dayKey({ year: 2026, month: 6, day: 5 })).toBe("2026-06-05");
  });
});

describe("weekdayOf", () => {
  it("knows Jun 29 2026 is a Monday (1)", () => {
    expect(weekdayOf(JUN29)).toBe(1);
  });
});

describe("addDays", () => {
  it("rolls over month boundaries", () => {
    expect(addDays({ year: 2026, month: 6, day: 30 }, 1)).toEqual({
      year: 2026,
      month: 7,
      day: 1,
    });
  });
  it("goes backward across a year boundary", () => {
    expect(addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });
});

describe("addMonths", () => {
  it("clamps the day to the target month length", () => {
    // Jan 31 + 1 month => Feb 28 (2026 is not a leap year).
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });
  it("rolls the year forward and backward", () => {
    expect(addMonths({ year: 2026, month: 12, day: 15 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 15,
    });
    expect(addMonths({ year: 2026, month: 1, day: 15 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 15,
    });
  });
});

describe("startOfWeek", () => {
  it("returns the Sunday on/before the day", () => {
    // Jun 29 2026 is Monday => its Sunday is Jun 28.
    expect(startOfWeek(JUN29)).toEqual({ year: 2026, month: 6, day: 28 });
  });
});

describe("monthGrid", () => {
  it("produces 42 cells starting on a Sunday", () => {
    const cells = monthGrid(JUN29);
    expect(cells).toHaveLength(42);
    expect(weekdayOf(cells[0].day)).toBe(0); // Sunday
  });
  it("flags in-month vs spillover days", () => {
    const cells = monthGrid(JUN29);
    // June 2026 starts on a Monday, so the first cell (Sunday May 31) is out of month.
    expect(cells[0].inMonth).toBe(false);
    expect(cells[0].day).toEqual({ year: 2026, month: 5, day: 31 });
    const jun15 = cells.find((c) => dayKey(c.day) === "2026-06-15");
    expect(jun15?.inMonth).toBe(true);
  });
});

describe("weekGrid", () => {
  it("returns 7 Sunday-first days", () => {
    const week = weekGrid(JUN29);
    expect(week).toHaveLength(7);
    expect(dayKey(week[0])).toBe("2026-06-28");
    expect(dayKey(week[6])).toBe("2026-07-04");
  });
});

describe("stepAnchor", () => {
  it("steps a month", () => {
    expect(stepAnchor(JUN29, "month", 1)).toEqual({ year: 2026, month: 7, day: 29 });
  });
  it("steps a week", () => {
    expect(dayKey(stepAnchor(JUN29, "week", -1))).toBe("2026-06-22");
  });
  it("steps a day", () => {
    expect(dayKey(stepAnchor(JUN29, "day", 1))).toBe("2026-06-30");
  });
});

describe("periodLabel", () => {
  it("labels a month", () => {
    expect(periodLabel(JUN29, "month")).toBe("June 2026");
  });
  it("labels a day", () => {
    expect(periodLabel(JUN29, "day")).toBe("Jun 29, 2026");
  });
  it("labels a week range", () => {
    expect(periodLabel(JUN29, "week")).toBe("Jun 28 – Jul 4, 2026");
  });
});
