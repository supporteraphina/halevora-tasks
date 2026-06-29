"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";
import { appendOrder } from "@/domain/ordering";
import { parseFieldValue, isCustomFieldKind } from "@/domain/customFields";
import {
  serializeBlueprint,
  parseBlueprint,
  materializePlan,
  type TaskSnapshot,
} from "@/domain/templates";
import { recordActivity } from "@/lib/activity";
import type { Priority } from "@/domain/priority";

const BOARD_PATH = "/board";
const TEMPLATES_PATH = "/board/templates";

export interface TemplateActionState {
  error?: string;
  ok?: boolean;
  /** The id of a newly-created template or task, for client navigation. */
  id?: string;
}

/**
 * Re-fetch a task the current actor may see, composing the scope fragment into the lookup.
 * The §3/§4 `findVisibleTask` gate: a client task id is NEVER trusted — a foreign/invisible
 * id returns null and the caller treats it the same as "not found" (no existence leak).
 */
async function findVisibleTaskId(taskId: string) {
  const actor = await requireActor();
  const task = await prisma.task.findFirst({
    where: { AND: [taskScopeWhere(actor), { id: taskId, archivedAt: null }] },
    select: { id: true, boardId: true },
  });
  return { actor, task };
}

/**
 * Save-as-template: snapshot a VISIBLE task's blueprint into a `TaskTemplate`.
 *
 * Re-authorizes the source task via the scope gate (the id is untrusted). Captures
 * title/description/priority/time-estimate, the task's checklists + items, its custom-field
 * VALUES (by field name + type so they re-bind on any board), and one level of subtasks
 * (each with its own checklists). The pure `serializeBlueprint` builds the `data` JSON.
 *
 * Authoring policy: ANY signed-in member who can SEE the task may save it as a template
 * (templates are shared team assets; reading/applying is open to all). Deleting is limited
 * to the author or a CEO (see `deleteTemplateAction`). The template is stored board-scoped
 * to the source task's board so create-from-template can re-bind custom fields by name.
 */
export async function saveAsTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!taskId) return { error: "Missing task." };
  if (name.length === 0) return { error: "Name the template first." };
  if (name.length > 120) return { error: "That name is too long." };
  if (description.length > 500) return { error: "That description is too long." };

  const { actor, task } = await findVisibleTaskId(taskId);
  if (!task) return { error: "Task not found." };

  // Gather the full snapshot from the (already authorized) source task. Subtasks are read
  // scoped to the actor too — a member only snapshots subtasks they can see.
  const source = await prisma.task.findUnique({
    where: { id: task.id },
    select: {
      title: true,
      description: true,
      priority: true,
      timeEstimate: true,
      checklists: {
        orderBy: { order: "asc" },
        select: {
          name: true,
          items: {
            orderBy: { order: "asc" },
            select: { content: true, done: true },
          },
        },
      },
      customFieldValues: {
        select: { value: true, field: { select: { name: true, type: true } } },
      },
    },
  });
  if (!source) return { error: "Task not found." };

  const subtaskRows = await prisma.task.findMany({
    where: { AND: [taskScopeWhere(actor), { parentId: task.id, archivedAt: null }] },
    orderBy: { order: "asc" },
    select: {
      title: true,
      priority: true,
      checklists: {
        orderBy: { order: "asc" },
        select: {
          name: true,
          items: { orderBy: { order: "asc" }, select: { content: true, done: true } },
        },
      },
    },
  });

  const snapshot: TaskSnapshot = {
    title: source.title,
    description: source.description ?? null,
    priority: source.priority,
    timeEstimate: source.timeEstimate,
    checklists: source.checklists.map((c) => ({
      name: c.name,
      items: c.items.map((i) => ({ content: i.content, done: i.done })),
    })),
    customFields: source.customFieldValues
      .filter((v) => v.value !== null && v.value !== undefined)
      .map((v) => ({ name: v.field.name, type: v.field.type, value: v.value })),
    subtasks: subtaskRows.map((s) => ({
      title: s.title,
      priority: s.priority,
      checklists: s.checklists.map((c) => ({
        name: c.name,
        items: c.items.map((i) => ({ content: i.content, done: i.done })),
      })),
    })),
  };

  const blueprint = serializeBlueprint(snapshot);

  const tpl = await prisma.taskTemplate.create({
    data: {
      name,
      description: description.length > 0 ? description : null,
      boardId: task.boardId,
      data: blueprint as unknown as Prisma.InputJsonValue,
      createdById: actor.userId,
    },
    select: { id: true },
  });

  revalidatePath(TEMPLATES_PATH);
  return { ok: true, id: tpl.id };
}

/**
 * Create-from-template: materialise a template's blueprint into a NEW task on a chosen board.
 *
 * Any signed-in user may apply a template (templates are shared). The TARGET board is
 * authorized (must exist + not archived) exactly like the normal create path, and the new
 * task auto-assigns the creator so a MEMBER can see what they just made (row-level scope).
 *
 * The blueprint `data` is UNTRUSTED — parsed defensively (`parseBlueprint`) then turned into
 * a pure `materializePlan`. The action walks the plan: it creates the task, its checklists +
 * items (reset to not-done), one level of subtasks (each auto-assigned to the creator so a
 * member can see them), and the custom-field VALUES — but only for fields that exist on the
 * TARGET board (matched by name + type) and only after RE-VALIDATING the stored value against
 * that field's live config via `parseFieldValue` (a stored value is never trusted into the DB).
 */
export async function createFromTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const actor = await requireActor();
  const templateId = String(formData.get("templateId") ?? "");
  const boardId = String(formData.get("boardId") ?? "");
  if (!templateId) return { error: "Pick a template." };
  if (!boardId) return { error: "Pick a board." };

  const template = await prisma.taskTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, data: true },
  });
  if (!template) return { error: "That template no longer exists." };

  // Authorize the TARGET board exists (same gate as the normal create path).
  const board = await prisma.board.findFirst({
    where: { id: boardId, archivedAt: null },
    select: { id: true },
  });
  if (!board) return { error: "That board no longer exists." };

  const plan = materializePlan(parseBlueprint(template.data));

  // The target board's custom field defs, for re-binding blueprint field values by name+type.
  const fields = await prisma.customField.findMany({
    where: { boardId },
    select: { id: true, name: true, type: true, config: true },
  });

  // order = end of the destination column.
  const max = await prisma.task.aggregate({
    where: { boardId, parentId: null, archivedAt: null },
    _max: { order: true },
  });

  // Create the top-level task first (auto-assign the creator for visibility).
  const created = await prisma.task.create({
    data: {
      boardId,
      title: plan.title,
      status: "TODO",
      priority: plan.priority as Priority,
      timeEstimate: plan.timeEstimate ?? null,
      description:
        plan.description !== undefined
          ? (plan.description as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      order: appendOrder(max._max.order),
      createdById: actor.userId,
      assignees: { connect: { id: actor.userId } },
    },
    select: { id: true },
  });

  // Checklists + items.
  for (let ci = 0; ci < plan.checklists.length; ci++) {
    const cl = plan.checklists[ci];
    await prisma.checklist.create({
      data: {
        taskId: created.id,
        name: cl.name,
        order: (ci + 1) * 1000,
        items: {
          create: cl.items.map((it, ii) => ({
            content: it.content,
            done: it.done,
            order: (ii + 1) * 1000,
          })),
        },
      },
    });
  }

  // Custom-field values — re-bind by (name + type) onto the target board's fields, and
  // RE-VALIDATE every stored value against the live field config before persisting.
  for (const cf of plan.customFields) {
    const field = fields.find((f) => f.name === cf.name && f.type === cf.type);
    if (!field || !isCustomFieldKind(field.type)) continue;
    const raw = stringifyFieldValue(cf.value);
    const parsed = parseFieldValue(field.type, field.config, raw);
    if (!parsed.ok || parsed.value === null) continue;

    // PEOPLE values must reference real users; connect only the ones that still exist.
    let peopleIds: string[] = [];
    if (field.type === "PEOPLE" && Array.isArray(parsed.value)) {
      const users = await prisma.user.findMany({
        where: { id: { in: parsed.value as string[] } },
        select: { id: true },
      });
      peopleIds = users.map((u) => u.id);
    }

    await prisma.customFieldValue.create({
      data: {
        taskId: created.id,
        fieldId: field.id,
        value: parsed.value as Prisma.InputJsonValue,
        ...(field.type === "PEOPLE"
          ? { people: { connect: peopleIds.map((id) => ({ id })) } }
          : {}),
      },
    });
  }

  // Subtasks (one level) — each auto-assigned to the creator so a member can see them.
  for (let si = 0; si < plan.subtasks.length; si++) {
    const sub = plan.subtasks[si];
    await prisma.task.create({
      data: {
        boardId,
        parentId: created.id,
        title: sub.title,
        status: "TODO",
        priority: sub.priority as Priority,
        order: (si + 1) * 1000,
        createdById: actor.userId,
        assignees: { connect: { id: actor.userId } },
        checklists: {
          create: sub.checklists.map((cl, ci) => ({
            name: cl.name,
            order: (ci + 1) * 1000,
            items: {
              create: cl.items.map((it, ii) => ({
                content: it.content,
                done: it.done,
                order: (ii + 1) * 1000,
              })),
            },
          })),
        },
      },
    });
  }

  await recordActivity({
    taskId: created.id,
    boardId,
    actorId: actor.userId,
    type: "template_applied",
    data: { template: template.name },
  });

  revalidatePath(BOARD_PATH);
  revalidatePath(`/board/task/${created.id}`);
  return { ok: true, id: created.id };
}

/**
 * Delete a template. Authoring policy: only the AUTHOR or a CEO may delete (templates are
 * shared assets — anyone reads/applies, but a member can't remove another member's template).
 * Enforced in the `where` so an unauthorized delete is a no-op, never an error leak.
 */
export async function deleteTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const actor = await requireActor();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing template." };

  const where: Prisma.TaskTemplateWhereInput =
    actor.role === "CEO"
      ? { id }
      : { id, createdById: actor.userId };

  const res = await prisma.taskTemplate.deleteMany({ where });
  if (res.count === 0) {
    return { error: "You can only delete templates you created." };
  }
  revalidatePath(TEMPLATES_PATH);
  return { ok: true };
}

/**
 * Stringify a stored blueprint field value into the form `parseFieldValue` expects:
 * arrays (LABELS/PEOPLE) become JSON, everything else its string form. null/undefined => "".
 */
function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
