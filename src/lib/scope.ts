/**
 * Server glue for row-level task scoping. Reads the Auth.js session and hands the
 * pure where-builder in src/domain/scope.ts the actor's { role, userId }.
 *
 * Later sections compose `taskWhereForCurrentUser()` into every Task read so a MEMBER
 * only ever sees tasks assigned to them. Keep the query-shaping in the pure domain
 * module; this file only resolves "who is asking".
 */
import { auth } from "@/auth";
import {
  taskScopeWhere,
  type ScopeActor,
  type TaskScopeWhere,
} from "@/domain/scope";
import type { Role } from "@prisma/client";

export interface SessionActor extends ScopeActor {
  name: string;
  email: string;
  timezone: string;
}

/** The current actor, or null if not signed in. */
export async function currentActor(): Promise<SessionActor | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  return {
    userId: u.id,
    role: u.role,
    name: u.name ?? "",
    email: u.email ?? "",
    timezone: u.timezone ?? "UTC",
  };
}

/** Like currentActor but throws when unauthenticated — for protected server code. */
export async function requireActor(): Promise<SessionActor> {
  const actor = await currentActor();
  if (!actor) throw new Error("UNAUTHENTICATED");
  return actor;
}

/** Throws unless the current actor has the given role (e.g. CEO-only admin paths). */
export async function requireRole(role: Role): Promise<SessionActor> {
  const actor = await requireActor();
  if (actor.role !== role) throw new Error("FORBIDDEN");
  return actor;
}

/**
 * The Prisma `Task` where fragment that scopes reads to what the current user may see.
 * `{}` for a CEO; `{ assignees: { some: { id } } }` for a MEMBER. Compose with other
 * filters via `{ AND: [taskScopeWhere(...), { boardId, parentId: null } ] }`.
 */
export async function taskWhereForCurrentUser(): Promise<TaskScopeWhere> {
  const actor = await requireActor();
  return taskScopeWhere(actor);
}
