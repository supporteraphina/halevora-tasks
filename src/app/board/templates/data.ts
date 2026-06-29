/**
 * Template management data loader. Server-only.
 *
 * Templates are SHARED team assets: every signed-in user may LIST and APPLY any template
 * (this is reference data, not row-scoped task content — a template is a blueprint, never a
 * task a member might be excluded from). The blueprint `data` JSON is parsed defensively so a
 * malformed row renders a safe summary instead of throwing. Board options drive the
 * create-from-template target picker; both are authorized at apply time, not here.
 */
import prisma from "@/lib/prisma";
import { parseBlueprint } from "@/domain/templates";

/** A template row projected for the management list + apply picker. */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  boardId: string | null;
  boardName: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
  // Defensive blueprint summary (counts only — never raw untrusted JSON to the client).
  taskTitle: string;
  checklistCount: number;
  customFieldCount: number;
  subtaskCount: number;
}

export async function loadTemplates(): Promise<TemplateSummary[]> {
  const rows = await prisma.taskTemplate.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      boardId: true,
      data: true,
      createdById: true,
      createdAt: true,
      board: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });

  return rows.map((t) => {
    const bp = parseBlueprint(t.data);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      boardId: t.boardId,
      boardName: t.board?.name ?? null,
      createdById: t.createdById,
      createdByName: t.createdBy?.name ?? null,
      createdAt: t.createdAt,
      taskTitle: bp.title,
      checklistCount: bp.checklists.length,
      customFieldCount: bp.customFields.length,
      subtaskCount: bp.subtasks.length,
    };
  });
}

/** Boards a template can be applied into (reference data; apply is authorized server-side). */
export async function loadTemplateBoardOptions(): Promise<
  { id: string; name: string }[]
> {
  return prisma.board.findMany({
    where: { archivedAt: null },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });
}
