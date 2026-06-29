import { describe, it, expect } from "vitest";
import {
  nextOccurrence,
  advanceDate,
  shouldRecurOnStatus,
  type RecurrenceSpec,
  type StatusRecurrenceRule,
} from "./recurrence";

/**
 * The recurrence engine's pure heart: given a rule (cadence + interval + an anchor UTC
 * instant) and a "from" UTC instant, compute the NEXT occurrence strictly after `from`,
 * in the actor's timezone. Dates are UTC-stored and computed in the actor's local zone
 * (compose src/domain/dates.ts), so a "daily at midnight" rule respects the configured
 * timezone, not the server's wall clock.
 *
 * `advanceDate` is the single-step primitive used to roll start/due forward when
 * "sync recurrence to due date" is on. `nextOccurrence` repeats it until it passes `from`.
 */

const UTC = "UTC";
const JM = "Asia/Jerusalem"; // UTC+2 winter, UTC+3 summer (DST)

function spec(over: Partial<RecurrenceSpec>): RecurrenceSpec {
  return { cadence: "DAILY", interval: 1, ...over };
}

describe("advanceDate — one cadence step from an anchor day, in the actor's zone", () => {
  it("DAILY interval 1 adds a day", () => {
    const d = advanceDate(new Date("2026-06-29T00:00:00Z"), spec({}), UTC);
    expect(d.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("DAILY interval 3 adds three days", () => {
    const d = advanceDate(
      new Date("2026-06-29T00:00:00Z"),
      spec({ cadence: "DAILY", interval: 3 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2026-07-02T00:00:00.000Z");
  });

  it("WEEKLY interval 1 adds seven days", () => {
    const d = advanceDate(
      new Date("2026-06-29T00:00:00Z"),
      spec({ cadence: "WEEKLY", interval: 1 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });

  it("WEEKLY interval 2 adds fourteen days", () => {
    const d = advanceDate(
      new Date("2026-06-29T00:00:00Z"),
      spec({ cadence: "WEEKLY", interval: 2 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("MONTHLY interval 1 keeps the day-of-month", () => {
    const d = advanceDate(
      new Date("2026-06-15T00:00:00Z"),
      spec({ cadence: "MONTHLY", interval: 1 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("MONTHLY interval 2 skips a month", () => {
    const d = advanceDate(
      new Date("2026-01-15T00:00:00Z"),
      spec({ cadence: "MONTHLY", interval: 2 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("MONTHLY clamps Jan 31 -> Feb 28 in a common year", () => {
    const d = advanceDate(
      new Date("2026-01-31T00:00:00Z"), // 2026 is not a leap year
      spec({ cadence: "MONTHLY", interval: 1 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("MONTHLY clamps Jan 31 -> Feb 29 in a leap year", () => {
    const d = advanceDate(
      new Date("2028-01-31T00:00:00Z"), // 2028 is a leap year
      spec({ cadence: "MONTHLY", interval: 1 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("MONTHLY clamps Aug 31 -> Sep 30 (30-day month)", () => {
    const d = advanceDate(
      new Date("2026-08-31T00:00:00Z"),
      spec({ cadence: "MONTHLY", interval: 1 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("MONTHLY rolls the year over from December", () => {
    const d = advanceDate(
      new Date("2026-12-10T00:00:00Z"),
      spec({ cadence: "MONTHLY", interval: 1 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2027-01-10T00:00:00.000Z");
  });

  it("YEARLY interval 1 adds a year", () => {
    const d = advanceDate(
      new Date("2026-06-29T00:00:00Z"),
      spec({ cadence: "YEARLY", interval: 1 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2027-06-29T00:00:00.000Z");
  });

  it("YEARLY clamps Feb 29 -> Feb 28 in a non-leap next year", () => {
    const d = advanceDate(
      new Date("2028-02-29T00:00:00Z"), // leap day
      spec({ cadence: "YEARLY", interval: 1 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });

  it("CUSTOM behaves like DAILY over `interval` days", () => {
    const d = advanceDate(
      new Date("2026-06-29T00:00:00Z"),
      spec({ cadence: "CUSTOM", interval: 10 }),
      UTC,
    );
    expect(d.toISOString()).toBe("2026-07-09T00:00:00.000Z");
  });
});

describe("advanceDate — timezone & DST correctness", () => {
  it("a Jerusalem-midnight anchor stays at local midnight after a daily step", () => {
    // 2026-06-29 00:00 Jerusalem (UTC+3 summer) == 2026-06-28T21:00:00Z.
    const anchor = new Date("2026-06-28T21:00:00Z");
    const next = advanceDate(anchor, spec({ cadence: "DAILY", interval: 1 }), JM);
    // The next local midnight (2026-06-30 00:00 JM) is also 21:00Z the day before.
    expect(next.toISOString()).toBe("2026-06-29T21:00:00.000Z");
  });

  it("crossing the spring-forward DST boundary keeps local midnight (offset shifts)", () => {
    // Israel 2026 DST starts Fri 2026-03-27 02:00 -> 03:00 (UTC+2 -> UTC+3).
    // Anchor: 2026-03-26 00:00 JM (UTC+2) == 2026-03-25T22:00:00Z.
    const anchor = new Date("2026-03-25T22:00:00Z");
    // +7 days lands on 2026-04-02 00:00 JM, now UTC+3 == 2026-04-01T21:00:00Z.
    const next = advanceDate(anchor, spec({ cadence: "WEEKLY", interval: 1 }), JM);
    expect(next.toISOString()).toBe("2026-04-01T21:00:00.000Z");
  });
});

describe("nextOccurrence — first occurrence strictly after `from`", () => {
  it("returns anchor + one step when `from` equals the anchor", () => {
    const anchor = new Date("2026-06-29T00:00:00Z");
    const from = new Date("2026-06-29T00:00:00Z");
    const next = nextOccurrence(anchor, from, spec({ cadence: "DAILY", interval: 1 }), UTC);
    expect(next.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("skips ahead past a stale anchor far in the past (no infinite loop)", () => {
    // Anchor a year ago, daily; from = today. Next must be strictly after `from`.
    const anchor = new Date("2025-06-29T00:00:00Z");
    const from = new Date("2026-06-29T12:00:00Z");
    const next = nextOccurrence(anchor, from, spec({ cadence: "DAILY", interval: 1 }), UTC);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    // The next daily midnight after 2026-06-29 12:00Z is 2026-06-30 00:00Z.
    expect(next.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("returns the anchor itself only when it is already after `from`", () => {
    const anchor = new Date("2026-07-01T00:00:00Z");
    const from = new Date("2026-06-29T00:00:00Z");
    const next = nextOccurrence(anchor, from, spec({ cadence: "DAILY", interval: 1 }), UTC);
    expect(next.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("monthly stale anchor: lands on the right future day-of-month", () => {
    // Anchor the 15th, monthly; from mid-cycle months later.
    const anchor = new Date("2026-01-15T00:00:00Z");
    const from = new Date("2026-04-20T00:00:00Z");
    const next = nextOccurrence(anchor, from, spec({ cadence: "MONTHLY", interval: 1 }), UTC);
    // Apr 15 is before `from`; next is May 15.
    expect(next.toISOString()).toBe("2026-05-15T00:00:00.000Z");
  });

  it("weekly interval 2 stale anchor stays on the right phase", () => {
    const anchor = new Date("2026-01-05T00:00:00Z"); // a Monday
    const from = new Date("2026-02-01T00:00:00Z");
    const next = nextOccurrence(anchor, from, spec({ cadence: "WEEKLY", interval: 2 }), UTC);
    // Phase: Jan 5, 19, Feb 2, ... First strictly after Feb 1 is Feb 2.
    expect(next.toISOString()).toBe("2026-02-02T00:00:00.000Z");
  });
});

describe("shouldRecurOnStatus — the inline ON_STATUS_CHANGE trigger gate", () => {
  function rule(over: Partial<StatusRecurrenceRule>): StatusRecurrenceRule {
    return {
      trigger: "ON_STATUS_CHANGE",
      triggerStatus: "REVIEWED",
      statusOnRecur: "TODO",
      ...over,
    };
  }

  it("fires when the new status equals the trigger status", () => {
    expect(shouldRecurOnStatus(rule({}), "IN_PROGRESS", "REVIEWED")).toBe(true);
  });

  it("does NOT fire when the new status is not the trigger status", () => {
    expect(shouldRecurOnStatus(rule({}), "TODO", "DONE")).toBe(false);
  });

  it("does NOT fire on a no-op (same old and new status) — idempotency", () => {
    expect(shouldRecurOnStatus(rule({}), "REVIEWED", "REVIEWED")).toBe(false);
  });

  it("respects a custom trigger status (e.g. DONE)", () => {
    expect(
      shouldRecurOnStatus(rule({ triggerStatus: "DONE" }), "IN_PROGRESS", "DONE"),
    ).toBe(true);
    expect(
      shouldRecurOnStatus(rule({ triggerStatus: "DONE" }), "IN_PROGRESS", "REVIEWED"),
    ).toBe(false);
  });

  it("defaults a missing trigger status to REVIEWED", () => {
    expect(
      shouldRecurOnStatus(rule({ triggerStatus: null }), "DONE", "REVIEWED"),
    ).toBe(true);
    expect(
      shouldRecurOnStatus(rule({ triggerStatus: null }), "TODO", "DONE"),
    ).toBe(false);
  });

  it("never fires for an ON_SCHEDULE rule (that path is the worker's)", () => {
    expect(
      shouldRecurOnStatus(
        rule({ trigger: "ON_SCHEDULE" }),
        "IN_PROGRESS",
        "REVIEWED",
      ),
    ).toBe(false);
  });
});

describe("computeNextRunAt-style usage (scheduled worker basis)", () => {
  it("advancing nextRunAt repeatedly never lands on or before the basis", () => {
    let cursor = new Date("2026-06-01T00:00:00Z");
    const from = new Date("2026-06-29T09:30:00Z");
    cursor = nextOccurrence(cursor, from, spec({ cadence: "DAILY", interval: 1 }), UTC);
    expect(cursor.getTime()).toBeGreaterThan(from.getTime());
    // Advancing once more is exactly +1 day.
    const after = advanceDate(cursor, spec({ cadence: "DAILY", interval: 1 }), UTC);
    expect(after.getTime() - cursor.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
