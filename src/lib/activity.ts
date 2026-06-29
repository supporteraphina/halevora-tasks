/**
 * Server glue to append an entry to the append-only ActivityLog. Server-only.
 *
 * The ActivityLog is APPEND-ONLY (see prisma/schema.prisma): this helper only ever
 * CREATEs a row — it never updates or deletes. Every detail mutation (§4 + §5) calls this
 * so the combined comments + activity feed is populated. The pure wording lives in
 * src/domain/activity.ts; this file only writes the structured (type, data) row.
 */
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { ActivityType } from "@/domain/activity";

/**
 * Append one activity entry for a task. Best-effort: a logging failure must never break
 * the underlying mutation, so errors are swallowed (the mutation already succeeded).
 */
export async function recordActivity(params: {
  taskId: string;
  boardId?: string | null;
  actorId: string;
  type: ActivityType;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        taskId: params.taskId,
        boardId: params.boardId ?? null,
        actorId: params.actorId,
        type: params.type,
        data: params.data
          ? (params.data as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  } catch {
    // Activity logging is non-critical; never surface an error to the caller.
  }
}
