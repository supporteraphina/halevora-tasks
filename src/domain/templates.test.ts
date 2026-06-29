import { describe, expect, it } from "vitest";
import {
  serializeBlueprint,
  parseBlueprint,
  materializePlan,
  type TaskBlueprint,
  type TaskSnapshot,
} from "./templates";

/** A full snapshot covering every field the serializer captures. */
function snapshot(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    title: "Launch checklist",
    description: { type: "doc", content: [{ type: "paragraph" }] },
    priority: "HIGH",
    timeEstimate: 90,
    checklists: [
      {
        name: "Pre-flight",
        items: [
          { content: "Draft copy", done: true },
          { content: "Get sign-off", done: false },
        ],
      },
    ],
    customFields: [
      { name: "Stage", type: "DROPDOWN", value: "opt1" },
      { name: "Progress", type: "SLIDER", value: 40 },
    ],
    subtasks: [
      {
        title: "Write brief",
        priority: "NORMAL",
        checklists: [{ name: "Notes", items: [{ content: "x", done: false }] }],
      },
    ],
    ...overrides,
  };
}

describe("serializeBlueprint", () => {
  it("captures the full task shape into a blueprint", () => {
    const bp = serializeBlueprint(snapshot());
    expect(bp.title).toBe("Launch checklist");
    expect(bp.priority).toBe("HIGH");
    expect(bp.timeEstimate).toBe(90);
    expect(bp.checklists).toHaveLength(1);
    expect(bp.checklists[0].items).toHaveLength(2);
    expect(bp.customFields).toHaveLength(2);
    expect(bp.subtasks).toHaveLength(1);
    expect(bp.subtasks[0].title).toBe("Write brief");
  });

  it("round-trips through parseBlueprint unchanged", () => {
    const bp = serializeBlueprint(snapshot());
    const json = JSON.parse(JSON.stringify(bp)); // simulate storage
    const parsed = parseBlueprint(json);
    expect(parsed).toEqual(bp);
  });

  it("drops a null description to undefined", () => {
    const bp = serializeBlueprint(snapshot({ description: null }));
    expect(bp.description).toBeUndefined();
  });

  it("omits a null time estimate", () => {
    const bp = serializeBlueprint(snapshot({ timeEstimate: null }));
    expect(bp.timeEstimate).toBeUndefined();
  });
});

describe("parseBlueprint — defensive parse of untrusted JSON", () => {
  it("never throws on garbage and yields a minimal valid blueprint", () => {
    for (const bad of [null, undefined, 42, "str", [], { foo: 1 }]) {
      const bp = parseBlueprint(bad);
      expect(typeof bp.title).toBe("string");
      expect(Array.isArray(bp.checklists)).toBe(true);
      expect(Array.isArray(bp.customFields)).toBe(true);
      expect(Array.isArray(bp.subtasks)).toBe(true);
    }
  });

  it("falls back to a default title when missing/blank", () => {
    expect(parseBlueprint({}).title).toBe("Untitled task");
    expect(parseBlueprint({ title: "   " }).title).toBe("Untitled task");
  });

  it("clamps an over-long title", () => {
    const long = "a".repeat(1000);
    expect(parseBlueprint({ title: long }).title.length).toBe(500);
  });

  it("coerces an unknown priority to NORMAL", () => {
    expect(parseBlueprint({ title: "x", priority: "WAT" }).priority).toBe("NORMAL");
    expect(parseBlueprint({ title: "x", priority: "URGENT" }).priority).toBe("URGENT");
  });

  it("drops malformed checklists and items", () => {
    const bp = parseBlueprint({
      title: "x",
      checklists: [
        "nope",
        { name: 5, items: "bad" },
        { name: "Good", items: [{ content: "a", done: true }, { content: 9 }, "x"] },
      ],
    });
    expect(bp.checklists).toHaveLength(2); // the {name:5} coerces to a usable checklist
    const good = bp.checklists.find((c) => c.name === "Good")!;
    expect(good.items).toHaveLength(1);
    expect(good.items[0]).toEqual({ content: "a", done: true });
  });

  it("keeps only known custom-field types and drops the rest", () => {
    const bp = parseBlueprint({
      title: "x",
      customFields: [
        { name: "A", type: "TEXT", value: "hi" },
        { name: "B", type: "BOGUS", value: 1 },
        { name: "", type: "NUMBER", value: 2 },
        "junk",
      ],
    });
    expect(bp.customFields).toHaveLength(1);
    expect(bp.customFields[0]).toEqual({ name: "A", type: "TEXT", value: "hi" });
  });

  it("parses one level of subtasks but ignores nested subtasks (no recursion bombs)", () => {
    const bp = parseBlueprint({
      title: "x",
      subtasks: [
        { title: "child", priority: "LOW", subtasks: [{ title: "grandchild" }] },
        "bad",
      ],
    });
    expect(bp.subtasks).toHaveLength(1);
    expect(bp.subtasks[0].title).toBe("child");
    expect(bp.subtasks[0].priority).toBe("LOW");
    // A subtask blueprint never carries its own subtasks.
    expect((bp.subtasks[0] as unknown as Record<string, unknown>).subtasks).toBeUndefined();
  });

  it("caps the number of subtasks and checklists to bound cost", () => {
    const manyChecklists = Array.from({ length: 200 }, (_, i) => ({
      name: `c${i}`,
      items: [],
    }));
    const manySubtasks = Array.from({ length: 500 }, (_, i) => ({ title: `s${i}` }));
    const bp = parseBlueprint({
      title: "x",
      checklists: manyChecklists,
      subtasks: manySubtasks,
    });
    expect(bp.checklists.length).toBeLessThanOrEqual(50);
    expect(bp.subtasks.length).toBeLessThanOrEqual(100);
  });
});

describe("materializePlan — turn a blueprint into a create plan", () => {
  it("produces a top-level task plan with checklists, fields, and subtasks", () => {
    const bp = parseBlueprint(serializeBlueprint(snapshot()) as unknown);
    const plan = materializePlan(bp);
    expect(plan.title).toBe("Launch checklist");
    expect(plan.priority).toBe("HIGH");
    expect(plan.timeEstimate).toBe(90);
    expect(plan.description).toEqual(snapshot().description);
    expect(plan.checklists).toHaveLength(1);
    expect(plan.checklists[0].items.map((i) => i.content)).toEqual([
      "Draft copy",
      "Get sign-off",
    ]);
    expect(plan.customFields).toHaveLength(2);
    expect(plan.subtasks).toHaveLength(1);
    expect(plan.subtasks[0].title).toBe("Write brief");
  });

  it("resets every checklist item to not-done in the materialised plan", () => {
    const bp = parseBlueprint({
      title: "x",
      checklists: [{ name: "c", items: [{ content: "a", done: true }] }],
    });
    const plan = materializePlan(bp);
    expect(plan.checklists[0].items[0].done).toBe(false);
  });

  it("subtask plans carry their own checklists but no further nesting", () => {
    const bp = parseBlueprint(serializeBlueprint(snapshot()) as unknown);
    const plan = materializePlan(bp);
    expect(plan.subtasks[0].checklists).toHaveLength(1);
    expect(plan.subtasks[0].checklists[0].name).toBe("Notes");
  });
});
