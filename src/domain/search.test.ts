import { describe, expect, it } from "vitest";
import {
  normalizeQuery,
  scoreTask,
  rankTasks,
  flattenDocText,
  MIN_QUERY_LENGTH,
  type SearchableTask,
} from "./search";

const T = (id: string, title: string, descriptionText = ""): SearchableTask => ({
  id,
  title,
  descriptionText,
});

describe("normalizeQuery", () => {
  it("trims, collapses whitespace, lowercases", () => {
    expect(normalizeQuery("  Meta   Ads ")).toBe("meta ads");
  });
  it("exposes a minimum length", () => {
    expect(MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
  });
});

describe("scoreTask", () => {
  it("ranks exact > prefix > contains > description-only > none", () => {
    const exact = scoreTask(T("1", "meta"), "meta");
    const prefix = scoreTask(T("2", "meta ads"), "meta");
    const contains = scoreTask(T("3", "new meta plan"), "meta");
    const descOnly = scoreTask(T("4", "unrelated", "about meta"), "meta");
    const none = scoreTask(T("5", "unrelated", "nothing"), "meta");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(descOnly);
    expect(descOnly).toBeGreaterThan(0);
    expect(none).toBe(0);
  });

  it("scores an earlier title position higher", () => {
    const early = scoreTask(T("1", "meta plan"), "meta");
    const late = scoreTask(T("2", "the big meta plan"), "meta");
    expect(early).toBeGreaterThan(late);
  });

  it("returns 0 for an empty query", () => {
    expect(scoreTask(T("1", "meta"), "")).toBe(0);
  });
});

describe("rankTasks", () => {
  it("drops non-matches and orders best-first", () => {
    const tasks = [
      T("a", "Unrelated thing"),
      T("b", "Meta Ads campaign"),
      T("c", "meta"),
      T("d", "Rework the meta tags"),
    ];
    const hits = rankTasks(tasks, "meta");
    expect(hits.map((h) => h.item.id)).toEqual(["c", "b", "d"]);
  });

  it("is stable on ties (title then id)", () => {
    const hits = rankTasks([T("z", "meta x"), T("a", "meta x")], "meta");
    expect(hits.map((h) => h.item.id)).toEqual(["a", "z"]);
  });
});

describe("flattenDocText", () => {
  it("flattens a Tiptap doc to plain text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "world" }] },
      ],
    };
    expect(flattenDocText(doc)).toBe("hello world");
  });

  it("returns empty for malformed input, never throwing", () => {
    expect(flattenDocText(null)).toBe("");
    expect(flattenDocText("nope")).toBe("");
    expect(flattenDocText(7)).toBe("");
  });
});
