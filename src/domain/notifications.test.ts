import { describe, expect, it } from "vitest";
import {
  isNotificationType,
  commentNotifyTargets,
  chatMentionTargets,
  assignedNotifyTargets,
} from "./notifications";

describe("isNotificationType", () => {
  it("accepts the known types and rejects others", () => {
    expect(isNotificationType("assigned")).toBe(true);
    expect(isNotificationType("mentioned")).toBe(true);
    expect(isNotificationType("commented")).toBe(true);
    expect(isNotificationType("nuke")).toBe(false);
    expect(isNotificationType(42)).toBe(false);
  });
});

describe("commentNotifyTargets", () => {
  it("notifies assignees + creator with `commented`", () => {
    const out = commentNotifyTargets({
      actorId: "a",
      mentionedIds: [],
      assigneeIds: ["x", "y"],
      creatorId: "z",
    });
    const byId = Object.fromEntries(out.map((t) => [t.recipientId, t.type]));
    expect(byId).toEqual({ x: "commented", y: "commented", z: "commented" });
  });

  it("never notifies the actor about their own comment", () => {
    const out = commentNotifyTargets({
      actorId: "a",
      mentionedIds: ["a"],
      assigneeIds: ["a", "b"],
      creatorId: "a",
    });
    expect(out).toEqual([{ recipientId: "b", type: "commented" }]);
  });

  it("a mention overrides a stakeholder `commented` to the stronger `mentioned`", () => {
    const out = commentNotifyTargets({
      actorId: "a",
      mentionedIds: ["x"],
      assigneeIds: ["x", "y"],
      creatorId: null,
    });
    const byId = Object.fromEntries(out.map((t) => [t.recipientId, t.type]));
    expect(byId).toEqual({ x: "mentioned", y: "commented" });
  });

  it("notifies a mentioned non-stakeholder with `mentioned`", () => {
    const out = commentNotifyTargets({
      actorId: "a",
      mentionedIds: ["q"],
      assigneeIds: ["y"],
      creatorId: null,
    });
    const byId = Object.fromEntries(out.map((t) => [t.recipientId, t.type]));
    expect(byId).toEqual({ y: "commented", q: "mentioned" });
  });

  it("emits at most one target per recipient (no double pings)", () => {
    const out = commentNotifyTargets({
      actorId: "a",
      mentionedIds: ["x"],
      assigneeIds: ["x"],
      creatorId: "x",
    });
    expect(out).toEqual([{ recipientId: "x", type: "mentioned" }]);
  });
});

describe("chatMentionTargets", () => {
  it("notifies each distinct mentioned user, excluding the actor", () => {
    const out = chatMentionTargets("a", ["b", "c", "b", "a"]);
    expect(out).toEqual([
      { recipientId: "b", type: "mentioned" },
      { recipientId: "c", type: "mentioned" },
    ]);
  });

  it("returns nothing when only the actor was mentioned", () => {
    expect(chatMentionTargets("a", ["a"])).toEqual([]);
  });
});

describe("assignedNotifyTargets", () => {
  it("notifies a newly-added assignee", () => {
    expect(assignedNotifyTargets("a", "b")).toEqual([
      { recipientId: "b", type: "assigned" },
    ]);
  });

  it("does not notify on self-assign", () => {
    expect(assignedNotifyTargets("a", "a")).toEqual([]);
  });
});
