/**
 * User / role domain helpers. Pure, framework-free.
 * Used by the CEO-only admin user-management surface and by auth input validation.
 */

import type { Role } from "@prisma/client";

/** Mirror of the Prisma `Role` enum. */
export const ROLES = ["CEO", "MEMBER"] as const;

/** Type guard for the Role union (validates untrusted form input). */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Canonical email form: trimmed and lowercased. Emails are unique on User. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface NewUserInput {
  name: string;
  email: string;
  role: string;
  password: string;
}

export interface ValidNewUser {
  name: string;
  email: string;
  role: Role;
  password: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const MIN_PASSWORD = 6;

/** Validate + normalize new-user input. Returns a discriminated Result. */
export function validateNewUser(input: NewUserInput): Result<ValidNewUser> {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, error: "Name is required." };

  const email = normalizeEmail(input.email);
  if (!email.includes("@") || email.length < 3) {
    return { ok: false, error: "A valid email is required." };
  }

  if (!isRole(input.role)) {
    return { ok: false, error: "Role must be CEO or MEMBER." };
  }

  if (input.password.length < MIN_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }

  return { ok: true, value: { name, email, role: input.role, password: input.password } };
}
