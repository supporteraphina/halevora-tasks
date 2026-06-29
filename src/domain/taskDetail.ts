/**
 * Pure validation + formatting helpers for the task detail panel. Framework-free.
 * Keep parsing/validation here so the server actions stay thin and the rules are tested.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Minutes ceiling — guards against typos like pasting a giant number. ~1000 days. */
const MAX_ESTIMATE_MIN = 60 * 24 * 1000;

/**
 * Parse a time-estimate field (minutes). Empty / blank / "0" clears the estimate (null).
 * Rejects non-integers, negatives, and absurd values.
 */
export function parseTimeEstimate(raw: string): Parsed<number | null> {
  const s = raw.trim();
  if (s.length === 0) return { ok: true, value: null };
  if (!/^\d+$/.test(s)) {
    return { ok: false, error: "Time estimate must be a whole number of minutes." };
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, error: "Time estimate must be a whole number of minutes." };
  }
  if (n > MAX_ESTIMATE_MIN) {
    return { ok: false, error: "That time estimate is too large." };
  }
  return { ok: true, value: n === 0 ? null : n };
}

/** Render minutes as "1h 30m" / "2h" / "45m", or an em-dash when unset. */
export function formatTimeEstimate(minutes: number | null): string {
  if (minutes == null || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Canonical tag key: trimmed, lowercased, internal whitespace collapsed. */
export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}
