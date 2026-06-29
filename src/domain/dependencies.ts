/**
 * Task dependencies — pure, framework-free domain logic.
 *
 * A `TaskDependency` is a single directed edge `blocker -> blocked`: the blocker must be
 * CLOSED before the blocked task may be marked Done (see src/domain/status.ts `isClosed`).
 *
 * THE load-bearing correctness piece (handoff 06 §6.1): adding an edge must never create a
 * cycle. A cycle means a task transitively blocks itself — an unsatisfiable state where the
 * Done-gate could never be cleared. This runs SERVER-SIDE before every insert; a client can
 * post any pair, so the graph is rebuilt from the trusted stored edges, not from the client.
 *
 * Kept pure + exhaustively unit-tested: a bug here is a correctness hole in the Done-gate.
 */

import { isClosed, type Status } from "./status";

/** A directed edge: `blocker` must close before `blocked` may be Done. */
export interface DepEdge {
  blockerId: string;
  blockedId: string;
}

/**
 * Would adding `candidate` to the existing edge set create a cycle?
 *
 * A self-edge (blocker === blocked) is trivially a cycle. Otherwise the new edge
 * `blocker -> blocked` closes a loop iff `blocker` is already reachable FROM `blocked` by
 * following the directed edges — i.e. there is a path blocked -> ... -> blocker. We DFS the
 * directed graph from `blocked` and see whether we can reach `blocker`.
 */
export function wouldCreateCycle(edges: DepEdge[], candidate: DepEdge): boolean {
  if (candidate.blockerId === candidate.blockedId) return true;

  // Adjacency: blocker -> [blocked, ...] (forward direction of the dependency).
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.blockerId);
    if (list) list.push(e.blockedId);
    else out.set(e.blockerId, [e.blockedId]);
  }

  // Can we reach `candidate.blockerId` starting from `candidate.blockedId`?
  const target = candidate.blockerId;
  const seen = new Set<string>();
  const stack = [candidate.blockedId];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === target) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    const next = out.get(node);
    if (next) stack.push(...next);
  }
  return false;
}

export type DependencyValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * The single server-side gate for adding a dependency. Rejects, in order:
 *  - a self-edge (a task cannot block itself),
 *  - a duplicate of an existing edge,
 *  - any edge that would create a cycle.
 * `edges` MUST be the trusted, stored edge set (rebuilt from the DB), never client input.
 */
export function validateNewDependency(
  edges: DepEdge[],
  candidate: DepEdge,
): DependencyValidation {
  if (candidate.blockerId === candidate.blockedId) {
    return { ok: false, error: "A task cannot depend on itself." };
  }
  const duplicate = edges.some(
    (e) =>
      e.blockerId === candidate.blockerId && e.blockedId === candidate.blockedId,
  );
  if (duplicate) {
    return { ok: false, error: "That link already exists." };
  }
  if (wouldCreateCycle(edges, candidate)) {
    return { ok: false, error: "That would create a circular dependency." };
  }
  return { ok: true };
}

/** How many of the given blockers are still OPEN (not closed). */
export function openBlockerCount(blockers: { status: Status }[]): number {
  return blockers.reduce((n, b) => (isClosed(b.status) ? n : n + 1), 0);
}
