"use server";

/**
 * Automation builder server actions (Section 8b) — CEO-gated, board-scoped create / update /
 * delete / reorder / toggle for a board's `AutomationRule`s.
 *
 * SECURITY: every action calls `requireRole("CEO")` FIRST (server-enforced, like
 * /admin/users — a MEMBER who POSTs here gets a thrown FORBIDDEN, never a write). The board
 * is verified to exist before any persistence.
 *
 * VALIDATION: the client sends the assembled rule as JSON (trigger / conditions / actions).
 * We NEVER trust that shape — we run it through the 8a engine's `parseRule` and reject the
 * rule if it returns null (unknown trigger) or drops every action. The engine, not the UI,
 * defines what a valid rule is; this file only assembles candidate JSON and gate-keeps it.
 *
 * SCHEDULED CLOCK: for a `scheduled` trigger we compute an initial `nextRunAt` (first
 * occurrence strictly after now, anchored on local midnight today, in the actor's timezone),
 * mirroring `setRecurrenceAction`'s anchoring. Event-driven triggers leave `nextRunAt` null.
 */

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { requireRole } from "@/lib/scope";
import { parseRule, type AutomationRule } from "@/domain/automation";
import { nextOccurrence } from "@/domain/recurrence";
import { Cadence } from "@prisma/client";

const CADENCE_VALUES = Object.values(Cadence) as string[];
function toCadence(v: unknown): Cadence {
  return typeof v === "string" && CADENCE_VALUES.includes(v)
    ? (v as Cadence)
    : Cadence.DAILY;
}

export interface AutomationActionState {
  error?: string;
  ok?: boolean;
}

const BOARD_PATH = "/board";
function rulesPath(boardId: string) {
  return `/board/automation/${boardId}`;
}

/** Verify the board exists (and is not archived). Returns null when it's gone. */
async function findBoard(boardId: string) {
  if (!boardId) return null;
  return prisma.board.findFirst({
    where: { id: boardId, archivedAt: null },
    select: { id: true },
  });
}

/** Parse a JSON form field into an unknown value; null when absent or unparseable. */
function parseJsonField(formData: FormData, key: string): unknown {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Assemble a candidate rule from the form and validate it with the 8a engine.
 * Returns the parsed engine rule on success, or an error string the action surfaces.
 * The board id and name come from trusted server inputs; trigger/conditions/actions are
 * the untrusted client JSON that `parseRule` gate-keeps.
 */
function assembleAndValidate(
  formData: FormData,
  boardId: string,
): { rule: AutomationRule; trigger: unknown; conditions: unknown; actions: unknown } | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return { error: "Give the rule a name." };
  if (name.length > 120) return { error: "That name is too long." };

  const trigger = parseJsonField(formData, "trigger");
  const conditions = parseJsonField(formData, "conditions") ?? [];
  const actions = parseJsonField(formData, "actions") ?? [];

  // Build the candidate object in the SAME shape the engine reads from the DB, then let the
  // engine validate it. parseRule returns null for an unknown trigger; it drops malformed
  // conditions/actions silently — so we additionally require at least one surviving action.
  const candidate = {
    id: "",
    boardId,
    name,
    enabled: true,
    order: 0,
    trigger,
    conditions,
    actions,
  };

  const rule = parseRule(candidate);
  if (!rule) return { error: "Pick a trigger for the rule." };
  if (rule.actions.length === 0) {
    return { error: "Add at least one action the rule can run." };
  }

  return { rule, trigger, conditions, actions };
}

/**
 * Compute the initial schedule clock for a `scheduled` rule: the first occurrence strictly
 * after now, anchored on local midnight today, in the actor's timezone. Event-driven
 * triggers return null (they fire inline, no clock).
 */
function computeNextRunAt(
  rule: AutomationRule,
  timezone: string,
): Date | null {
  if (rule.trigger.type !== "scheduled") return null;
  const cfg = rule.trigger.config ?? {};
  const cadence = toCadence(cfg.cadence);
  const intervalRaw = typeof cfg.interval === "number" ? Math.trunc(cfg.interval) : 1;
  const interval = intervalRaw >= 1 ? intervalRaw : 1;
  const now = new Date();
  return nextOccurrence(now, now, { cadence, interval }, timezone);
}

/** Create a new automation rule on a board (CEO only). Order = end of the list. */
export async function createRuleAction(
  _prev: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const actor = await requireRole("CEO");

  const boardId = String(formData.get("boardId") ?? "");
  const board = await findBoard(boardId);
  if (!board) return { error: "That board no longer exists." };

  const assembled = assembleAndValidate(formData, boardId);
  if ("error" in assembled) return { error: assembled.error };
  const { rule, trigger, conditions, actions } = assembled;

  // order = end of the list (max + 1) so a new rule runs last by default.
  const max = await prisma.automationRule.aggregate({
    where: { boardId },
    _max: { order: true },
  });
  const order = (max._max.order ?? -1) + 1;

  await prisma.automationRule.create({
    data: {
      boardId,
      name: rule.name,
      enabled: true,
      trigger: trigger as object,
      conditions: (conditions ?? []) as object,
      actions: (actions ?? []) as object,
      order,
      nextRunAt: computeNextRunAt(rule, actor.timezone),
      createdById: actor.userId,
    },
  });

  revalidatePath(rulesPath(boardId));
  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/** Update an existing rule's name / trigger / conditions / actions (CEO only). */
export async function updateRuleAction(
  _prev: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const actor = await requireRole("CEO");

  const id = String(formData.get("id") ?? "");
  const boardId = String(formData.get("boardId") ?? "");
  if (!id) return { error: "Missing rule." };

  const board = await findBoard(boardId);
  if (!board) return { error: "That board no longer exists." };

  // The rule must belong to this board (never edit across boards by id alone).
  const existing = await prisma.automationRule.findFirst({
    where: { id, boardId },
    select: { id: true },
  });
  if (!existing) return { error: "That rule no longer exists." };

  const assembled = assembleAndValidate(formData, boardId);
  if ("error" in assembled) return { error: assembled.error };
  const { rule, trigger, conditions, actions } = assembled;

  await prisma.automationRule.update({
    where: { id },
    data: {
      name: rule.name,
      trigger: trigger as object,
      conditions: (conditions ?? []) as object,
      actions: (actions ?? []) as object,
      // Recompute the schedule clock from the (possibly changed) trigger; null for events.
      nextRunAt: computeNextRunAt(rule, actor.timezone),
    },
  });

  revalidatePath(rulesPath(boardId));
  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/** Toggle a rule on or off (CEO only). A disabled rule is skipped by the engine. */
export async function toggleRuleAction(
  _prev: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  await requireRole("CEO");

  const id = String(formData.get("id") ?? "");
  const boardId = String(formData.get("boardId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!id) return { error: "Missing rule." };

  const board = await findBoard(boardId);
  if (!board) return { error: "That board no longer exists." };

  const result = await prisma.automationRule.updateMany({
    where: { id, boardId },
    data: { enabled },
  });
  if (result.count === 0) return { error: "That rule no longer exists." };

  revalidatePath(rulesPath(boardId));
  return { ok: true };
}

/** Delete a rule (CEO only). Its run-log rows cascade away with it (schema onDelete). */
export async function deleteRuleAction(
  _prev: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  await requireRole("CEO");

  const id = String(formData.get("id") ?? "");
  const boardId = String(formData.get("boardId") ?? "");
  if (!id) return { error: "Missing rule." };

  const board = await findBoard(boardId);
  if (!board) return { error: "That board no longer exists." };

  await prisma.automationRule.deleteMany({ where: { id, boardId } });

  revalidatePath(rulesPath(boardId));
  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/**
 * Move a rule up or down in run order (CEO only) by swapping `order` with its neighbor.
 * Rules run in ascending `order`; this is the simple, predictable two-row swap.
 */
export async function reorderRuleAction(
  _prev: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  await requireRole("CEO");

  const id = String(formData.get("id") ?? "");
  const boardId = String(formData.get("boardId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id) return { error: "Missing rule." };
  if (direction !== "up" && direction !== "down") {
    return { error: "Bad direction." };
  }

  const board = await findBoard(boardId);
  if (!board) return { error: "That board no longer exists." };

  const rules = await prisma.automationRule.findMany({
    where: { boardId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, order: true },
  });

  const index = rules.findIndex((r) => r.id === id);
  if (index === -1) return { error: "That rule no longer exists." };

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rules.length) {
    // Already at the end of the list in that direction — nothing to do.
    return { ok: true };
  }

  const a = rules[index];
  const b = rules[swapWith];
  await prisma.$transaction([
    prisma.automationRule.update({ where: { id: a.id }, data: { order: b.order } }),
    prisma.automationRule.update({ where: { id: b.id }, data: { order: a.order } }),
  ]);

  revalidatePath(rulesPath(boardId));
  return { ok: true };
}
