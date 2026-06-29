"use server";

/**
 * Global search — SCOPED to the actor (the security boundary). The task query composes
 * `taskScopeWhere(actor)` exactly like every other read: a MEMBER only ever finds tasks they
 * are assigned to; the CEO finds all. A bare `prisma.task.findMany` here would be a leak — the
 * scope fragment is ANDed into the WHERE so the database never returns a row the actor can't see.
 *
 * Pure ranking/match lives in src/domain/search.ts (TDD); this action only resolves "who is
 * asking", runs the scoped query (a cheap title/description `contains` prefilter), then ranks
 * the returned rows. Description matching uses a flattened-text scan in the domain layer.
 */
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import {
  normalizeQuery,
  rankTasks,
  flattenDocText,
  MIN_QUERY_LENGTH,
  type SearchableTask,
} from "@/domain/search";
import type { Status } from "@prisma/client";

export interface SearchResult {
  id: string;
  title: string;
  status: Status;
  boardName: string;
}

/**
 * Search tasks the actor may see by title/description. Returns [] for a too-short query.
 * The Prisma prefilter narrows to rows whose title OR description text contains the query
 * (case-insensitive); the domain ranker then scores + orders. Subtasks and archived tasks are
 * excluded (the board-level surface). Capped at a small result set for the overlay.
 */
export async function searchAction(rawQuery: string): Promise<{
  results: SearchResult[];
  query: string;
}> {
  const actor = await requireActor();
  const query = normalizeQuery(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) return { results: [], query };

  // SCOPED prefilter: visibility fragment AND (title OR description contains the query).
  // `description` is JSON; Postgres `contains` on a Json column is not available, so we match
  // the title in SQL and rank the description in-memory after flattening (cheap at team scale).
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        taskScopeWhere(actor),
        {
          parentId: null,
          archivedAt: null,
          board: { archivedAt: null },
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            // A coarse description prefilter: scan recent tasks too so description-only matches
            // are reachable. We over-fetch a bounded window and rank precisely below.
            { title: { not: "" } },
          ],
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      description: true,
      board: { select: { name: true } },
    },
  });

  const searchable: (SearchableTask & { status: Status; boardName: string })[] =
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      descriptionText: flattenDocText(r.description),
      status: r.status,
      boardName: r.board.name,
    }));

  const ranked = rankTasks(searchable, query).slice(0, 20);
  return {
    results: ranked.map((h) => ({
      id: h.item.id,
      title: h.item.title,
      status: h.item.status,
      boardName: h.item.boardName,
    })),
    query,
  };
}
