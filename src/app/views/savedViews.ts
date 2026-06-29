/**
 * Saved-view persistence: owner-scoped CRUD. Server-only.
 *
 * A SavedView is PRIVATE to its owner (every query is scoped by `ownerId = actor.userId`),
 * so one user can never read or mutate another's view. Crucially, a saved view stores only a
 * sort+filter CONFIG and a `kind`; it carries no task visibility of its own — when a view is
 * opened, the task read still composes `taskWhereForCurrentUser()`. The "all" kind (All-CEO)
 * is additionally role-gated at the page level.
 */
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { parseViewConfig, type ViewConfig } from "@/domain/views";

/** The view kinds a saved view may refine. "all" is CEO-only (page-gated). */
export const VIEW_KINDS = [
  "my_tasks",
  "all",
  "today",
  "reviewed",
  "calendar",
] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export function isViewKind(v: string): v is ViewKind {
  return (VIEW_KINDS as readonly string[]).includes(v);
}

export interface SavedViewSummary {
  id: string;
  name: string;
  kind: ViewKind;
  config: ViewConfig;
}

/** The current actor's saved views (owner-scoped), oldest first. Config parsed defensively. */
export async function loadSavedViews(): Promise<SavedViewSummary[]> {
  const actor = await requireActor();
  const rows = await prisma.savedView.findMany({
    where: { ownerId: actor.userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, kind: true, config: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: isViewKind(r.kind) ? r.kind : "my_tasks",
    config: parseViewConfig(r.config),
  }));
}

/** One saved view by id, ONLY if owned by the current actor (else null — never leak). */
export async function loadSavedView(
  id: string,
): Promise<SavedViewSummary | null> {
  const actor = await requireActor();
  const row = await prisma.savedView.findFirst({
    where: { id, ownerId: actor.userId },
    select: { id: true, name: true, kind: true, config: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: isViewKind(row.kind) ? row.kind : "my_tasks",
    config: parseViewConfig(row.config),
  };
}
