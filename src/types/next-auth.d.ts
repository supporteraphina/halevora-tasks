/**
 * Module augmentation: carry the app's `role` + `id` (and `timezone`) on the
 * Auth.js session and JWT. Without this, `session.user.role` would be untyped.
 */
import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      timezone: string;
    } & DefaultSession["user"];
  }

  // The object returned by the Credentials `authorize` callback.
  interface User {
    role: Role;
    timezone: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    timezone: string;
  }
}
