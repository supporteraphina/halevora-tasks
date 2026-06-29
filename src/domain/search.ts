/**
 * Global-search match + ranking. Pure, framework-free.
 *
 * Section 12's global search queries tasks the actor MAY SEE (the DB read composes
 * `taskScopeWhere(actor)` — the security boundary lives there, never here). This module owns
 * only the pure, presentation-side concerns: normalizing the query, deciding whether a row
 * matches, and ranking matches so the best titles surface first. It carries NO scope logic —
 * it operates on rows the scoped query already returned, so it can never widen visibility.
 */

/** A task row, reduced to the fields search ranks over. */
export interface SearchableTask {
  id: string;
  title: string;
  /** Plain-text flattening of the Tiptap description (or "" when none). */
  descriptionText: string;
}

export interface SearchHit<T> {
  item: T;
  score: number;
}

/** Trim + collapse whitespace + lowercase a raw query. Empty => no search. */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The minimum query length we run a search for (avoids a full-table scan on one keystroke). */
export const MIN_QUERY_LENGTH = 2;

/**
 * Score one task against a NORMALIZED query (already lowercased/trimmed). Higher is better;
 * 0 means no match. The ranking favours, in order:
 *   - an exact title match (the strongest signal),
 *   - a title that STARTS WITH the query,
 *   - the query appearing anywhere in the title,
 *   - the query appearing only in the description.
 * Earlier title position scores slightly higher so "Meta" ranks "Meta Ads" above "New Meta".
 */
export function scoreTask(task: SearchableTask, query: string): number {
  if (!query) return 0;
  const title = task.title.toLowerCase();
  if (title === query) return 1000;
  if (title.startsWith(query)) return 800;
  const titleIdx = title.indexOf(query);
  if (titleIdx >= 0) return 600 - Math.min(titleIdx, 100);
  if (task.descriptionText.toLowerCase().includes(query)) return 200;
  return 0;
}

/**
 * Rank a set of (already scope-filtered) tasks for a normalized query, dropping non-matches.
 * Stable order on ties by title then id, so results don't jitter between identical scores.
 */
export function rankTasks<T extends SearchableTask>(
  tasks: T[],
  query: string,
): SearchHit<T>[] {
  const hits: SearchHit<T>[] = [];
  for (const t of tasks) {
    const score = scoreTask(t, query);
    if (score > 0) hits.push({ item: t, score });
  }
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const t = a.item.title.localeCompare(b.item.title);
    return t !== 0 ? t : a.item.id.localeCompare(b.item.id);
  });
  return hits;
}

/**
 * Flatten a Tiptap document (or any nested {text, content} tree) to plain text for matching.
 * Defensive: untrusted JSON, never throws, returns "" on anything malformed.
 */
export function flattenDocText(doc: unknown): string {
  const parts: string[] = [];
  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) for (const c of n.content) walk(c);
  }
  try {
    walk(doc);
  } catch {
    return "";
  }
  return parts.join(" ");
}
