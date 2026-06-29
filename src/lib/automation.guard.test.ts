import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Loop-guard proof for the automation execution glue (Section 8a). The mandate: a rule whose
 * action would re-fire its OWN trigger must NOT loop infinitely — the re-entrancy depth is
 * capped at MAX_AUTOMATION_DEPTH and the cascade stops there.
 *
 * We mock @/lib/prisma with a tiny in-memory fake. The seeded rule is self-referential:
 *   trigger  = status_changed -> IN_PROGRESS
 *   action   = set_status IN_PROGRESS ... but the task already in IN_PROGRESS would be a
 *              no-op, so to FORCE a cascade we make the action flip between two statuses with
 *              two mutually-triggering rules — a classic ping-pong that without the guard
 *              would never terminate.
 *
 * Rule A: on status -> TODO,        set_status IN_PROGRESS   (=> emits status_changed to IN_PROGRESS)
 * Rule B: on status -> IN_PROGRESS, set_status TODO          (=> emits status_changed to TODO)
 *
 * Each applied flip re-enters runAutomationsForEvent at depth+1. With MAX_AUTOMATION_DEPTH = 5
 * the chain must terminate after a BOUNDED number of hops (the cap), proving no infinite loop.
 */

// --- In-memory fake prisma --------------------------------------------------

interface FakeTask {
  id: string;
  boardId: string;
  title: string;
  status: string;
  priority: string;
  startAt: Date | null;
  dueAt: Date | null;
  tagIds: string[];
  tagNames: string[];
  assigneeIds: string[];
}

const state: {
  task: FakeTask;
  rules: Array<Record<string, unknown>>;
  runLogs: Array<{ ruleId: string; status: string; detail: unknown }>;
  activity: Array<Record<string, unknown>>;
  statusUpdates: number;
} = {
  task: {
    id: "t1",
    boardId: "b1",
    title: "Ping pong",
    status: "TODO",
    priority: "NORMAL",
    startAt: null,
    dueAt: null,
    tagIds: [],
    tagNames: [],
    assigneeIds: [],
  },
  rules: [],
  runLogs: [],
  activity: [],
  statusUpdates: 0,
};

vi.mock("@/lib/prisma", () => {
  const prisma = {
    automationRule: {
      findMany: vi.fn(async () => state.rules),
    },
    task: {
      findUnique: vi.fn(async () => ({
        id: state.task.id,
        boardId: state.task.boardId,
        title: state.task.title,
        status: state.task.status,
        priority: state.task.priority,
        startAt: state.task.startAt,
        dueAt: state.task.dueAt,
        tags: state.task.tagNames.map((name, i) => ({ id: `tag${i}`, name })),
        assignees: state.task.assigneeIds.map((id) => ({ id })),
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.status === "string") {
          state.task.status = data.status;
          state.statusUpdates += 1;
        }
        if (typeof data.priority === "string") state.task.priority = data.priority;
        return { id: state.task.id };
      }),
    },
    tag: {
      upsert: vi.fn(async () => ({ id: "tag-x" })),
      findUnique: vi.fn(async () => null),
    },
    user: { findUnique: vi.fn(async () => ({ id: "u1" })) },
    comment: { create: vi.fn(async () => ({ id: "c1" })) },
    automationRunLog: {
      create: vi.fn(async ({ data }: { data: { ruleId: string; status: string; detail: unknown } }) => {
        state.runLogs.push({ ruleId: data.ruleId, status: data.status, detail: data.detail });
        return { id: `log${state.runLogs.length}` };
      }),
    },
    activityLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.activity.push(data);
        return { id: `a${state.activity.length}` };
      }),
    },
  };
  return { default: prisma };
});

// Import AFTER the mock is registered.
import { runAutomationsForEvent, MAX_AUTOMATION_DEPTH } from "./automation";

beforeEach(() => {
  state.task = {
    id: "t1",
    boardId: "b1",
    title: "Ping pong",
    status: "TODO",
    priority: "NORMAL",
    startAt: null,
    dueAt: null,
    tagIds: [],
    tagNames: [],
    assigneeIds: [],
  };
  state.runLogs = [];
  state.activity = [];
  state.statusUpdates = 0;
});

describe("runAutomationsForEvent loop-guard", () => {
  it("stops a self-re-triggering rule chain at MAX_AUTOMATION_DEPTH (no infinite loop)", async () => {
    // Two mutually-triggering rules form a ping-pong that, unguarded, never terminates.
    state.rules = [
      {
        id: "ruleA",
        boardId: "b1",
        name: "TODO -> IN_PROGRESS",
        enabled: true,
        order: 0,
        trigger: { type: "status_changed", config: { to: "TODO" } },
        conditions: [],
        actions: [{ type: "set_status", status: "IN_PROGRESS" }],
      },
      {
        id: "ruleB",
        boardId: "b1",
        name: "IN_PROGRESS -> TODO",
        enabled: true,
        order: 1,
        trigger: { type: "status_changed", config: { to: "IN_PROGRESS" } },
        conditions: [],
        actions: [{ type: "set_status", status: "TODO" }],
      },
    ];

    // Kick off the chain with a status_changed -> TODO event (fires ruleA).
    const result = await runAutomationsForEvent({
      boardId: "b1",
      taskId: "t1",
      event: { type: "status_changed", from: "REVIEWED", to: "TODO" },
      actorId: "actor1",
    });

    // The cascade terminated (the call returned at all). The number of status flips is
    // bounded by the depth cap — strictly fewer than an unbounded loop would produce.
    expect(state.statusUpdates).toBeLessThanOrEqual(MAX_AUTOMATION_DEPTH + 1);
    expect(state.statusUpdates).toBeGreaterThan(0);
    // At least one success was recorded, and the pass completed without hanging.
    expect(result.applied).toBeGreaterThan(0);
    expect(state.runLogs.some((r) => r.status === "success")).toBe(true);
  });

  it("returns immediately once depth reaches the cap", async () => {
    state.rules = [
      {
        id: "ruleA",
        boardId: "b1",
        name: "always",
        enabled: true,
        order: 0,
        trigger: { type: "status_changed", config: {} },
        conditions: [],
        actions: [{ type: "set_status", status: "DONE" }],
      },
    ];
    const result = await runAutomationsForEvent({
      boardId: "b1",
      taskId: "t1",
      event: { type: "status_changed", from: "TODO", to: "IN_PROGRESS" },
      actorId: "actor1",
      depth: MAX_AUTOMATION_DEPTH,
    });
    // At/over the cap, the pass does nothing (no rules loaded, no mutations).
    expect(result.evaluated).toBe(0);
    expect(result.applied).toBe(0);
    expect(state.statusUpdates).toBe(0);
  });
});
