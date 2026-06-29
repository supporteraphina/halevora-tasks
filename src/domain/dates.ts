/**
 * Date math for the task detail date picker. Pure, framework-free domain logic.
 *
 * THE invariant (handoff 04 gotchas): dates are UTC-stored, per-user rendered. The
 * picker's quick choices ("Today", "This weekend", ...) are anchored to the ACTOR'S
 * local calendar day, not the server's. A stored due date is the UTC instant marking
 * midnight (00:00) of the chosen local day, so it renders as that same calendar day in
 * the actor's timezone everywhere.
 *
 * We avoid a date library: `Intl.DateTimeFormat` with a `timeZone` gives the wall-clock
 * parts of any instant in any zone, and from that we can both (a) read the local
 * calendar day of "now" and (b) convert a chosen local midnight back to its UTC instant.
 */

export type QuickChoice =
  | "today"
  | "tomorrow"
  | "this_weekend"
  | "next_week"
  | "two_weeks"
  | "four_weeks";

export interface QuickChoiceSpec {
  key: QuickChoice;
  label: string;
}

/** The six ClickUp date-picker quick choices, in screenshot order. */
export const QUICK_CHOICES: QuickChoiceSpec[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "this_weekend", label: "This weekend" },
  { key: "next_week", label: "Next week" },
  { key: "two_weeks", label: "2 weeks" },
  { key: "four_weeks", label: "4 weeks" },
];

/** A plain calendar day, timezone-free. */
interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const MS_PER_MINUTE = 60_000;

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

/**
 * The UTC instant marking midnight (00:00) of `day` in `timeZone`. Computed by
 * pinning a guess at UTC midnight, measuring the zone's offset there, then correcting —
 * one correction is exact for all real-world zones (whole-minute offsets).
 */
function zonedMidnightToUtc(day: CalendarDay, timeZone: string): Date {
  // Guess: treat the wanted wall-clock as if it were UTC.
  const guess = Date.UTC(day.year, day.month - 1, day.day, 0, 0, 0, 0);
  const offset = offsetMinutes(new Date(guess), timeZone);
  const corrected = guess - offset * MS_PER_MINUTE;
  // Re-measure at the corrected instant in case the offset differs (DST edge); correct again.
  const offset2 = offsetMinutes(new Date(corrected), timeZone);
  if (offset2 !== offset) {
    return new Date(guess - offset2 * MS_PER_MINUTE);
  }
  return new Date(corrected);
}

/**
 * The timezone's offset from UTC, in minutes, at `instant` (positive = ahead of UTC,
 * e.g. Asia/Jerusalem in summer = +180). Derived by comparing the zone's wall clock to
 * the same instant's UTC wall clock.
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  return Math.round((asUtc - instant.getTime()) / MS_PER_MINUTE);
}

/** Add `days` to a calendar day (handles month/year rollover via UTC arithmetic). */
function addDays(day: CalendarDay, days: number): CalendarDay {
  const t = Date.UTC(day.year, day.month - 1, day.day) + days * 86_400_000;
  const d = new Date(t);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** Day of week for a calendar day, 0 = Sunday .. 6 = Saturday. */
function weekday(day: CalendarDay): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
}

/**
 * The UTC instant for a quick choice, anchored to the actor's local "now".
 * "This weekend" = the coming Saturday (today if today is Saturday).
 * "Next week" = the coming Monday (the Monday after today; if today is Monday, +7).
 */
export function quickChoiceDate(
  choice: QuickChoice,
  now: Date,
  timeZone: string,
): Date {
  const today = calendarDayInZone(now, timeZone);
  let target: CalendarDay;

  switch (choice) {
    case "today":
      target = today;
      break;
    case "tomorrow":
      target = addDays(today, 1);
      break;
    case "this_weekend": {
      const wd = weekday(today); // 6 = Saturday
      const delta = (6 - wd + 7) % 7; // days until the coming Saturday (0 if today)
      target = addDays(today, delta);
      break;
    }
    case "next_week": {
      const wd = weekday(today); // 1 = Monday
      // Days until the next Monday; if today is Monday, jump a full week.
      const delta = ((1 - wd + 7) % 7) || 7;
      target = addDays(today, delta);
      break;
    }
    case "two_weeks":
      target = addDays(today, 14);
      break;
    case "four_weeks":
      target = addDays(today, 28);
      break;
  }

  return zonedMidnightToUtc(target, timeZone);
}

/** Render a UTC instant as a short date ("Jun 29, 2026") in the actor's timezone. */
export function formatInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(instant);
}

/** The `<input type="date">` value (YYYY-MM-DD) for an instant, in the actor's zone. */
export function dateInputValue(instant: Date, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

/**
 * True when two UTC instants fall on the SAME calendar day in `timeZone`. Used by the
 * "Today" view to bucket a task's due date against the actor's local "now" — never compared
 * in server-UTC (a task due late evening local could otherwise land on the wrong day).
 */
export function isSameDayInZone(a: Date, b: Date, timeZone: string): boolean {
  return dateInputValue(a, timeZone) === dateInputValue(b, timeZone);
}

/**
 * Parse a YYYY-MM-DD (from a date input) as midnight of that day in `timeZone`,
 * returning the UTC instant. Returns null for empty/malformed/out-of-range input.
 */
export function parseDateInput(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible days (e.g. Feb 30) by round-tripping through Date.UTC.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return zonedMidnightToUtc({ year, month, day }, timeZone);
}
