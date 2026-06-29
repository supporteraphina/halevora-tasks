/**
 * Calendar grid math. Pure, framework-free domain logic (TDD'd).
 *
 * Builds the day cells for the month / week / day views. A "day" is a plain
 * { year, month, day } in the actor's local calendar — the page derives each from a UTC
 * instant via the timezone-aware helpers in src/domain/dates.ts, so the calendar is always
 * the actor's local calendar (never server-UTC). Weeks start on Sunday (ClickUp default).
 */

export interface CalDay {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export type CalendarMode = "month" | "week" | "day";

/** ISO-ish key (YYYY-MM-DD) for a calendar day — the join key against a task's due day. */
export function dayKey(d: CalDay): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}

/** Day-of-week for a calendar day, 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(d: CalDay): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

/** Add `n` days to a calendar day (UTC arithmetic handles month/year rollover). */
export function addDays(d: CalDay, n: number): CalDay {
  const t = Date.UTC(d.year, d.month - 1, d.day) + n * 86_400_000;
  const x = new Date(t);
  return {
    year: x.getUTCFullYear(),
    month: x.getUTCMonth() + 1,
    day: x.getUTCDate(),
  };
}

/** Add `n` whole months to a calendar day, clamping the day to the target month's length. */
export function addMonths(d: CalDay, n: number): CalDay {
  const zero = d.month - 1 + n;
  const year = d.year + Math.floor(zero / 12);
  const month = ((zero % 12) + 12) % 12; // 0-11
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { year, month: month + 1, day: Math.min(d.day, lastDay) };
}

/** The first day of `d`'s month. */
export function startOfMonth(d: CalDay): CalDay {
  return { year: d.year, month: d.month, day: 1 };
}

/** The Sunday on/before `d` (start of its week). */
export function startOfWeek(d: CalDay): CalDay {
  return addDays(d, -weekdayOf(d));
}

/**
 * The 6x7 = 42 day grid for the month containing `anchor`, starting on the Sunday on/before
 * the 1st and running 42 cells (covers every month layout). Each cell carries whether it is
 * in the anchor's month (for dimming the leading/trailing days).
 */
export function monthGrid(anchor: CalDay): { day: CalDay; inMonth: boolean }[] {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  const cells: { day: CalDay; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const day = addDays(gridStart, i);
    cells.push({ day, inMonth: day.month === anchor.month && day.year === anchor.year });
  }
  return cells;
}

/** The 7 days of the week containing `anchor`, Sunday-first. */
export function weekGrid(anchor: CalDay): CalDay[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Step the anchor by one unit of `mode` in `dir` (-1 prev, +1 next). */
export function stepAnchor(
  anchor: CalDay,
  mode: CalendarMode,
  dir: -1 | 1,
): CalDay {
  if (mode === "month") return addMonths(anchor, dir);
  if (mode === "week") return addDays(anchor, dir * 7);
  return addDays(anchor, dir);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Title for the current view, e.g. "June 2026" (month) or "Jun 29, 2026" (day). */
export function periodLabel(anchor: CalDay, mode: CalendarMode): string {
  const m = MONTH_NAMES[anchor.month - 1];
  if (mode === "month") return `${m} ${anchor.year}`;
  if (mode === "day") return `${m.slice(0, 3)} ${anchor.day}, ${anchor.year}`;
  const week = weekGrid(anchor);
  const a = week[0];
  const b = week[6];
  const am = MONTH_NAMES[a.month - 1].slice(0, 3);
  const bm = MONTH_NAMES[b.month - 1].slice(0, 3);
  return `${am} ${a.day} – ${bm} ${b.day}, ${b.year}`;
}
