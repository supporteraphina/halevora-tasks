/**
 * Recurrence date math. Pure, framework-free domain logic — the heart of Section 7.
 *
 * THE invariant (mirrors src/domain/dates.ts): dates are UTC-stored, computed in the
 * actor's timezone. A recurrence anchor is the UTC instant marking local midnight of a
 * chosen day; advancing it keeps the result pinned to local midnight of the new day, so a
 * "daily/weekly/monthly" rule respects the configured zone, not server wall-clock time —
 * and DST boundaries shift the stored UTC instant by the offset delta automatically.
 *
 * Two functions:
 *   - `advanceDate(anchor, spec, tz)`  — ONE cadence step forward from `anchor`.
 *   - `nextOccurrence(anchor, from, spec, tz)` — the first occurrence strictly after `from`,
 *     stepping from `anchor` (clamped so a stale anchor never loops forever).
 *
 * Month/year cadences clamp an out-of-range day to the last day of the target month
 * (Jan 31 + 1 month -> Feb 28/29; Feb 29 + 1 year -> Feb 28). Daily/weekly/custom are
 * exact day arithmetic. We reuse the zone<->UTC midnight conversion approach from dates.ts.
 */

import type { Cadence, RecurrenceTrigger, Status } from "@prisma/client";

/** The minimal recurrence shape the math needs (a subset of RecurrenceRule). */
export interface RecurrenceSpec {
  cadence: Cadence;
  interval: number; // every N cadence units; >= 1
}

/** The fields of a RecurrenceRule the inline ON_STATUS_CHANGE engine reasons over. */
export interface StatusRecurrenceRule {
  trigger: RecurrenceTrigger;
  triggerStatus: Status | null;
  statusOnRecur: Status;
}

/**
 * Pure decision: does moving a task INTO `newStatus` fire its ON_STATUS_CHANGE recurrence?
 *
 * Fires only when ALL hold:
 *   - the rule's trigger is ON_STATUS_CHANGE,
 *   - the task is actually transitioning (oldStatus !== newStatus) — re-saving the same
 *     status never re-spawns (idempotency at the decision layer), and
 *   - `newStatus` matches the configured `triggerStatus` (defaulting to REVIEWED, the
 *     "leaves the board" end state, when the rule stored none).
 *
 * The actual spawn is still guarded by a DB-level idempotency check (the rule is consumed),
 * but this keeps the trigger semantics pure and unit-tested.
 */
export function shouldRecurOnStatus(
  rule: StatusRecurrenceRule,
  oldStatus: Status,
  newStatus: Status,
): boolean {
  if (rule.trigger !== "ON_STATUS_CHANGE") return false;
  if (oldStatus === newStatus) return false;
  const trigger = rule.triggerStatus ?? "REVIEWED";
  return newStatus === trigger;
}

/** A plain calendar day, timezone-free. */
interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** The wall-clock parts of `instant` as seen in `timeZone`. */
function partsInZone(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // some engines render midnight as "24"
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
  };
}

/** The actor's local calendar day for the given instant. */
function calendarDayInZone(instant: Date, timeZone: string): CalendarDay {
  const p = partsInZone(instant, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** The timezone's offset from UTC, in minutes, at `instant` (positive = ahead of UTC). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  return Math.round((asUtc - instant.getTime()) / MS_PER_MINUTE);
}

/**
 * The UTC instant marking midnight (00:00) of `day` in `timeZone`. Pins a guess at UTC
 * midnight, measures the zone's offset there, corrects, then re-measures once (exact for
 * all real-world whole-minute zones, including across DST edges).
 */
function zonedMidnightToUtc(day: CalendarDay, timeZone: string): Date {
  const guess = Date.UTC(day.year, day.month - 1, day.day, 0, 0, 0, 0);
  const offset = offsetMinutes(new Date(guess), timeZone);
  const corrected = guess - offset * MS_PER_MINUTE;
  const offset2 = offsetMinutes(new Date(corrected), timeZone);
  if (offset2 !== offset) {
    return new Date(guess - offset2 * MS_PER_MINUTE);
  }
  return new Date(corrected);
}

/** Days in a given month (1-12), accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add `days` to a calendar day (handles month/year rollover via UTC arithmetic). */
function addCalendarDays(day: CalendarDay, days: number): CalendarDay {
  const t = Date.UTC(day.year, day.month - 1, day.day) + days * MS_PER_DAY;
  const d = new Date(t);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * Add `months` to a calendar day, clamping the day to the target month's last day
 * (Jan 31 + 1 month -> Feb 28/29; Aug 31 + 1 month -> Sep 30). `months` may exceed 12.
 */
function addCalendarMonths(day: CalendarDay, months: number): CalendarDay {
  const zeroBased = day.month - 1 + months;
  const year = day.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1; // 1-12
  const clampedDay = Math.min(day.day, daysInMonth(year, month));
  return { year, month, day: clampedDay };
}

/** Add `years` to a calendar day, clamping Feb 29 -> Feb 28 in a non-leap target year. */
function addCalendarYears(day: CalendarDay, years: number): CalendarDay {
  const year = day.year + years;
  const clampedDay = Math.min(day.day, daysInMonth(year, day.month));
  return { year, month: day.month, day: clampedDay };
}

/** One cadence step from a calendar day, in the actor's zone. */
function stepCalendarDay(day: CalendarDay, spec: RecurrenceSpec): CalendarDay {
  const n = Math.max(1, Math.trunc(spec.interval || 1));
  switch (spec.cadence) {
    case "DAILY":
    case "CUSTOM": // CUSTOM = every N days (escape hatch; config-driven variants come later)
      return addCalendarDays(day, n);
    case "WEEKLY":
      return addCalendarDays(day, n * 7);
    case "MONTHLY":
      return addCalendarMonths(day, n);
    case "YEARLY":
      return addCalendarYears(day, n);
    default:
      return addCalendarDays(day, n);
  }
}

/**
 * ONE cadence step forward from `anchor`, returned as the UTC instant marking local
 * midnight of the new day in `timeZone`. This is the primitive used to roll start/due
 * forward when "sync recurrence to due date" is on.
 */
export function advanceDate(
  anchor: Date,
  spec: RecurrenceSpec,
  timeZone: string,
): Date {
  const day = calendarDayInZone(anchor, timeZone);
  const stepped = stepCalendarDay(day, spec);
  return zonedMidnightToUtc(stepped, timeZone);
}

/**
 * The first occurrence STRICTLY AFTER `from`, stepping forward from `anchor` by the
 * cadence. If `anchor` is already after `from`, it is returned (re-pinned to local
 * midnight). Otherwise we advance until we pass `from`. A guard caps the loop so a wildly
 * stale anchor can never spin (it bails to a from-relative computation).
 */
export function nextOccurrence(
  anchor: Date,
  from: Date,
  spec: RecurrenceSpec,
  timeZone: string,
): Date {
  // Normalize the anchor to its local-midnight UTC instant so comparisons are clean.
  let cursor = zonedMidnightToUtc(
    calendarDayInZone(anchor, timeZone),
    timeZone,
  );

  if (cursor.getTime() > from.getTime()) return cursor;

  // Step forward until strictly past `from`. The cap is generous (covers daily steps for
  // ~30 years) but bounded — beyond it we fall back to a small from-anchored search.
  const MAX_STEPS = 12_000;
  for (let i = 0; i < MAX_STEPS; i++) {
    cursor = advanceDate(cursor, spec, timeZone);
    if (cursor.getTime() > from.getTime()) return cursor;
  }

  // Fallback (only reached for a pathologically stale anchor): step from `from` itself,
  // preserving the cadence phase as best as a single step can. Guarantees a result after
  // `from` without an unbounded loop.
  let safe = zonedMidnightToUtc(calendarDayInZone(from, timeZone), timeZone);
  while (safe.getTime() <= from.getTime()) {
    safe = advanceDate(safe, spec, timeZone);
  }
  return safe;
}
