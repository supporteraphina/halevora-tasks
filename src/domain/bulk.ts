/**
 * Bulk edit — pure, framework-free helpers for multi-select batch mutations.
 *
 * The selection id list arrives from the client and is UNTRUSTED: `parseTaskIds` sanitizes
 * it (drops blanks/non-strings, de-dupes, and CAPS the length so a batch can never be
 * unbounded). The op guards reject any status/priority the enum doesn't allow (e.g. the
 * derived OVERDUE is never a stored status). The result accounting turns the action's
 * per-id outcome counts into a human summary.
 *
 * SECURITY NOTE: sanitizing the id list here does NOT authorize anything. The server action
 * still re-authorizes EVERY id against the actor's scope (`findVisibleTask` / a scoped
 * `updateMany` whose `where` composes `taskScopeWhere`). This module only bounds and cleans
 * the input; visibility is enforced in the query, never here.
 */

import { STATUSES, type Status } from "./status";
import { PRIORITIES, type Priority } from "./priority";

/** Hard cap on a single batch so a malicious/huge selection can't run unbounded work. */
export const MAX_BULK_IDS = 200;

const MAX_ID_LEN = 60;

/**
 * Sanitize an untrusted selection into a clean, de-duplicated, capped id list. Accepts an
 * array of ids OR a JSON-encoded array string (the form transport). Never throws.
 */
export function parseTaskIds(input: unknown): string[] {
  let arr: unknown = input;
  if (typeof input === "string") {
    try {
      arr = JSON.parse(input);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id.length === 0 || id.length > MAX_ID_LEN) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_BULK_IDS) break;
  }
  return out;
}

/** A valid bulk status target — one of the STORED statuses (never the derived OVERDUE). */
export function isBulkStatusOp(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}

/** A valid bulk priority target. */
export function isBulkPriorityOp(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as string[]).includes(v);
}

/** Per-batch outcome accounting returned to the client. */
export interface BulkResult {
  updated: number; // tasks actually mutated
  skipped: number; // ids the actor couldn't see / didn't exist (silently ignored)
  blocked: number; // tasks refused by the Done-gate (open blockers) on a close
}

/** Parse a possibly-partial result object into a complete one (defaults to zeros). */
export function parseBulkResult(input: unknown): BulkResult {
  const r =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0;
  return {
    updated: num(r.updated),
    skipped: num(r.skipped),
    blocked: num(r.blocked),
  };
}

/** A short human summary of a batch outcome, for the toolbar status line. */
export function summarizeBulk(r: BulkResult): string {
  const parts: string[] = [];
  parts.push(`${r.updated} updated`);
  if (r.blocked > 0) {
    parts.push(`${r.blocked} blocked by open task${r.blocked === 1 ? "" : "s"}`);
  }
  if (r.skipped > 0) {
    parts.push(`${r.skipped} couldn't be changed`);
  }
  return parts.join(" · ");
}
