/**
 * Automation builder data loader (Section 8b). Server-only. Loads one board, its rules
 * (ordered as the engine runs them), and the user/tag pickers the editor needs.
 *
 * READ SCOPE: the calling page CEO-gates before invoking this. Automation rules are a
 * board-level configuration surface, not task data, so there is no per-row task scoping here
 * — a member never reaches this loader (the page redirects them away, server-enforced).
 */
import prisma from "@/lib/prisma";
import { parseRule } from "@/domain/automation";
import {
  summarizeTrigger,
  summarizeActions,
} from "@/domain/automationSummary";

export interface RuleListItem {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  /** The raw stored JSON the editor re-hydrates from. */
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  /** Pre-computed human-readable summaries for the list (engine-validated). */
  triggerSummary: string;
  actionSummary: string;
  /** True when the stored rule is structurally valid per the engine. */
  valid: boolean;
  nextRunAt: string | null;
}

export interface AutomationPageData {
  board: { id: string; name: string };
  rules: RuleListItem[];
  users: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

/** Load the board, its rules, and pickers for the builder. Null when the board is gone. */
export async function loadAutomationPage(
  boardId: string,
): Promise<AutomationPageData | null> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!board) return null;

  const [rawRules, users, tags] = await Promise.all([
    prisma.automationRule.findMany({
      where: { boardId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        enabled: true,
        order: true,
        trigger: true,
        conditions: true,
        actions: true,
        nextRunAt: true,
      },
    }),
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rules: RuleListItem[] = rawRules.map((r) => {
    const parsed = parseRule(r);
    return {
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      order: r.order,
      trigger: r.trigger,
      conditions: r.conditions,
      actions: r.actions,
      triggerSummary: parsed
        ? summarizeTrigger(parsed.trigger)
        : "Unrecognized trigger",
      actionSummary: parsed ? summarizeActions(parsed.actions) : "",
      valid: parsed !== null,
      nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
    };
  });

  return {
    board: { id: board.id, name: board.name },
    rules,
    users,
    tags,
  };
}
