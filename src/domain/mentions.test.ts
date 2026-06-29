import { describe, expect, it } from "vitest";
import {
  candidateHandles,
  extractMentionIds,
  extractMentionIdsFromDoc,
  type MentionCandidate,
} from "./mentions";

const NOEL: MentionCandidate = {
  id: "u-noel",
  name: "Noel Pollak",
  email: "noel@halevora.com",
};
const MEMBER1: MentionCandidate = {
  id: "u-m1",
  name: "Member One",
  email: "member1@halevora.com",
};
const USERS = [NOEL, MEMBER1];

describe("candidateHandles", () => {
  it("collapses the name and adds the email local-part", () => {
    expect(candidateHandles(NOEL)).toEqual(["noelpollak", "noel"]);
  });

  it("does not duplicate when name-handle equals the local-part", () => {
    const u = { id: "x", name: "bob", email: "bob@x.com" };
    expect(candidateHandles(u)).toEqual(["bob"]);
  });
});

describe("extractMentionIds", () => {
  it("resolves a name-handle mention", () => {
    expect(extractMentionIds("hey @noelpollak look", USERS)).toEqual(["u-noel"]);
  });

  it("resolves an email-local-part mention", () => {
    expect(extractMentionIds("ping @member1 please", USERS)).toEqual(["u-m1"]);
  });

  it("ignores trailing punctuation", () => {
    expect(extractMentionIds("done, @member1.", USERS)).toEqual(["u-m1"]);
  });

  it("does not treat an email address as a mention (@ must follow a non-word char)", () => {
    expect(extractMentionIds("write to noel@halevora.com now", USERS)).toEqual([]);
  });

  it("de-dupes a user mentioned twice", () => {
    expect(extractMentionIds("@member1 and again @member1", USERS)).toEqual(["u-m1"]);
  });

  it("resolves multiple distinct users", () => {
    const ids = extractMentionIds("@noel and @member1", USERS).sort();
    expect(ids).toEqual(["u-m1", "u-noel"]);
  });

  it("ignores an unknown handle", () => {
    expect(extractMentionIds("@ghost where are you", USERS)).toEqual([]);
  });

  it("returns nothing for empty input or no candidates", () => {
    expect(extractMentionIds("", USERS)).toEqual([]);
    expect(extractMentionIds("@noel", [])).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(extractMentionIds("@NOELPOLLAK", USERS)).toEqual(["u-noel"]);
  });
});

describe("extractMentionIdsFromDoc", () => {
  it("flattens a Tiptap doc and resolves text mentions", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "cc @member1 on this" }],
        },
      ],
    };
    expect(extractMentionIdsFromDoc(doc, USERS)).toEqual(["u-m1"]);
  });

  it("resolves a structured mention node by attrs.id when it is a real user", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "u-noel", label: "Noel" } }],
        },
      ],
    };
    expect(extractMentionIdsFromDoc(doc, USERS)).toEqual(["u-noel"]);
  });

  it("ignores a structured mention id that is not a known user", () => {
    const doc = {
      type: "doc",
      content: [{ type: "mention", attrs: { id: "u-stranger" } }],
    };
    expect(extractMentionIdsFromDoc(doc, USERS)).toEqual([]);
  });

  it("never throws on malformed input", () => {
    expect(extractMentionIdsFromDoc(null, USERS)).toEqual([]);
    expect(extractMentionIdsFromDoc("not a doc", USERS)).toEqual([]);
    expect(extractMentionIdsFromDoc(42, USERS)).toEqual([]);
  });
});
