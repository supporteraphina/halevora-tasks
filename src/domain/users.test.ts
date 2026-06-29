import { describe, expect, it } from "vitest";
import { ROLES, isRole, normalizeEmail, validateNewUser } from "./users";

describe("user domain helpers", () => {
  it("lists the two roles", () => {
    expect(ROLES).toEqual(["CEO", "MEMBER"]);
  });

  it("isRole guards the Role union", () => {
    expect(isRole("CEO")).toBe(true);
    expect(isRole("MEMBER")).toBe(true);
    expect(isRole("ADMIN")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("normalizeEmail lowercases and trims", () => {
    expect(normalizeEmail("  Noel@Halevora.com ")).toBe("noel@halevora.com");
  });
});

describe("validateNewUser", () => {
  it("accepts a well-formed user", () => {
    const r = validateNewUser({
      name: "Dana",
      email: "dana@halevora.com",
      role: "MEMBER",
      password: "halevora",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("dana@halevora.com");
      expect(r.value.name).toBe("Dana");
      expect(r.value.role).toBe("MEMBER");
    }
  });

  it("normalizes the email and trims the name", () => {
    const r = validateNewUser({
      name: "  Dana  ",
      email: "  Dana@Halevora.com ",
      role: "CEO",
      password: "halevora",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("dana@halevora.com");
      expect(r.value.name).toBe("Dana");
    }
  });

  it("rejects a missing name", () => {
    const r = validateNewUser({ name: "  ", email: "x@y.com", role: "MEMBER", password: "halevora" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });

  it("rejects an email without @", () => {
    const r = validateNewUser({ name: "X", email: "not-an-email", role: "MEMBER", password: "halevora" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/email/i);
  });

  it("rejects an invalid role", () => {
    const r = validateNewUser({ name: "X", email: "x@y.com", role: "ADMIN", password: "halevora" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/role/i);
  });

  it("rejects a password shorter than 6 characters", () => {
    const r = validateNewUser({ name: "X", email: "x@y.com", role: "MEMBER", password: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/password/i);
  });
});
