/**
 * Row-level task visibility. Pure, framework-free domain logic.
 *
 * THE load-bearing security invariant of Halevora Tasks (see handoff 00 §4):
 *   - A CEO sees ALL tasks.
 *   - A MEMBER sees ONLY tasks they are an assignee of (any member may assign to anyone —
 *     scoping is on READ, never on who can be picked as an assignee).
 *
 * This builds the Prisma `Task` `where` fragment that enforces that invariant. Every Task
 * read in later sections composes this fragment (server glue lives in src/lib/scope.ts).
 * A bug here is a data leak, so the logic is kept pure and exhaustively unit-tested.
 *
 * Subtasks are Tasks too (self-relation via parentId), so the same builder applies: a
 * member sees a subtask only when assigned to that subtask, independent of its parent.
 * The caller layers any parentId / board filter on top of this fragment.
 */

import type { Role } from "@prisma/client";

/** The minimal identity the scope builder needs — derived from the session. */
export interface ScopeActor {
  role: Role;
  userId: string;
}

/**
 * A Prisma `Task` where fragment, intentionally narrow. `{}` matches every task; the
 * assignee form matches only tasks the member is on. Shaped to compose with AND/spread.
 */
export type TaskScopeWhere =
  | Record<string, never>
  | { assignees: { some: { id: string } } };

/**
 * Build the visibility where-fragment for the given actor.
 * CEO => {} (all tasks). MEMBER => only tasks where they are an assignee.
 */
export function taskScopeWhere(actor: ScopeActor): TaskScopeWhere {
  if (actor.role === "CEO") return {};
  return { assignees: { some: { id: actor.userId } } };
}

/**
 * Single-row visibility predicate, mirroring `taskScopeWhere` for in-memory checks
 * (e.g. authorizing a mutation or filtering an already-fetched list / realtime event).
 */
export function canSeeTask(
  actor: ScopeActor,
  task: { assigneeIds: string[] },
): boolean {
  if (actor.role === "CEO") return true;
  return task.assigneeIds.includes(actor.userId);
}
