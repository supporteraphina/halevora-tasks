import { describe, expect, it } from "vitest";
import {
  boardChannel,
  isValidChannel,
  encodeEvent,
  decodeEvent,
  canReceiveEvent,
  type RealtimeEvent,
} from "./realtime";

const CEO = { role: "CEO" as const, userId: "u-ceo" };
const MEMBER = { role: "MEMBER" as const, userId: "u-m" };

describe("boardChannel / isValidChannel", () => {
  it("builds a board_<id> channel name", () => {
    expect(boardChannel("abc123")).toBe("board_abc123");
  });

  it("accepts a well-formed cuid-shaped channel", () => {
    expect(isValidChannel("board_ckabc123def456")).toBe(true);
  });

  it("rejects channels that are not board_<lowercase-alnum>", () => {
    expect(isValidChannel("board_")).toBe(false);
    expect(isValidChannel("task_abc")).toBe(false);
    expect(isValidChannel("board_ABC")).toBe(false); // uppercase
    expect(isValidChannel("board_abc; DROP TABLE")).toBe(false); // injection attempt
    expect(isValidChannel("board_" + "x".repeat(70))).toBe(false); // > 63 bytes
  });
});

describe("encodeEvent / decodeEvent round-trip", () => {
  it("round-trips a task event (ids only — no content)", () => {
    const e: RealtimeEvent = { type: "task", taskId: "t1", boardId: "b1" };
    const wire = encodeEvent(e);
    expect(wire).not.toContain("title"); // codec carries no content
    expect(decodeEvent(wire)).toEqual(e);
  });

  it("round-trips a chat event", () => {
    const e: RealtimeEvent = { type: "chat", boardId: "b1", messageId: "m1" };
    expect(decodeEvent(encodeEvent(e))).toEqual(e);
  });

  it("round-trips a presence event", () => {
    const e: RealtimeEvent = {
      type: "presence",
      boardId: "b1",
      userId: "u1",
      presence: "join",
    };
    expect(decodeEvent(encodeEvent(e))).toEqual(e);
  });
});

describe("decodeEvent — defensive parsing (never throws, drops bad input)", () => {
  it("returns null for non-JSON", () => {
    expect(decodeEvent("not json{")).toBeNull();
  });

  it("returns null for a JSON value that is not an object", () => {
    expect(decodeEvent("42")).toBeNull();
    expect(decodeEvent("null")).toBeNull();
    expect(decodeEvent('"x"')).toBeNull();
  });

  it("returns null for an unknown event type", () => {
    expect(decodeEvent(JSON.stringify({ type: "nuke", boardId: "b1" }))).toBeNull();
  });

  it("requires a boardId on every event (the routing key)", () => {
    expect(decodeEvent(JSON.stringify({ type: "task", taskId: "t1" }))).toBeNull();
  });

  it("requires a taskId on a task event", () => {
    expect(decodeEvent(JSON.stringify({ type: "task", boardId: "b1" }))).toBeNull();
  });

  it("requires a messageId on a chat event", () => {
    expect(decodeEvent(JSON.stringify({ type: "chat", boardId: "b1" }))).toBeNull();
  });

  it("requires userId + presence on a presence event", () => {
    expect(
      decodeEvent(JSON.stringify({ type: "presence", boardId: "b1", userId: "u1" })),
    ).toBeNull();
    expect(
      decodeEvent(
        JSON.stringify({ type: "presence", boardId: "b1", presence: "join" }),
      ),
    ).toBeNull();
  });

  it("ignores extra/unknown fields and any content that rides along", () => {
    const decoded = decodeEvent(
      JSON.stringify({ type: "task", taskId: "t1", boardId: "b1", title: "SECRET" }),
    );
    expect(decoded).toEqual({ type: "task", taskId: "t1", boardId: "b1" });
    expect(decoded as object).not.toHaveProperty("title");
  });
});

describe("canReceiveEvent — per-subscriber authorization (THE leak gate)", () => {
  it("a CEO receives every event type unconditionally", () => {
    expect(
      canReceiveEvent(CEO, { type: "task", taskId: "t1", boardId: "b1" }, {}),
    ).toBe(true);
    expect(
      canReceiveEvent(CEO, { type: "chat", boardId: "b1", messageId: "m1" }, {}),
    ).toBe(true);
    expect(
      canReceiveEvent(
        CEO,
        { type: "presence", boardId: "b1", userId: "u1", presence: "join" },
        {},
      ),
    ).toBe(true);
  });

  it("a MEMBER receives a task event ONLY when the task is visible to them now", () => {
    const e: RealtimeEvent = { type: "task", taskId: "t1", boardId: "b1" };
    expect(canReceiveEvent(MEMBER, e, { taskVisible: true })).toBe(true);
    expect(canReceiveEvent(MEMBER, e, { taskVisible: false })).toBe(false);
    // Unresolved visibility => deny (fail closed; never learn the task exists).
    expect(canReceiveEvent(MEMBER, e, {})).toBe(false);
  });

  it("a MEMBER receives chat/presence ONLY when the board is visible to them", () => {
    const chat: RealtimeEvent = { type: "chat", boardId: "b1", messageId: "m1" };
    const pres: RealtimeEvent = {
      type: "presence",
      boardId: "b1",
      userId: "u1",
      presence: "leave",
    };
    expect(canReceiveEvent(MEMBER, chat, { boardVisible: true })).toBe(true);
    expect(canReceiveEvent(MEMBER, chat, { boardVisible: false })).toBe(false);
    expect(canReceiveEvent(MEMBER, chat, {})).toBe(false);
    expect(canReceiveEvent(MEMBER, pres, { boardVisible: true })).toBe(true);
    expect(canReceiveEvent(MEMBER, pres, { boardVisible: false })).toBe(false);
  });

  it("never lets a member's task-visibility fact leak across event kinds", () => {
    // A chat event must NOT be authorized by a task being visible — only board visibility counts.
    const chat: RealtimeEvent = { type: "chat", boardId: "b1", messageId: "m1" };
    expect(canReceiveEvent(MEMBER, chat, { taskVisible: true })).toBe(false);
  });
});
