/**
 * Auth.js (NextAuth v5) — full server-side config.
 *
 * Strategy: Credentials provider against the own `User` table + JWT sessions.
 * No Account/Session/VerificationToken adapter tables are needed (so no migration);
 * the session is a signed JWT carrying { id, role, timezone } (see src/auth.config.ts
 * callbacks and src/types/next-auth.d.ts).
 *
 * Export `auth` for server components / route handlers / server actions to read the
 * session, and `signIn`/`signOut` for the login + sign-out flows.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { normalizeEmail } from "@/domain/users";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email: normalizeEmail(email) },
        });
        // No user, or a passwordless account (e.g. future SSO-only) => reject.
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // The object here becomes `user` in the jwt callback. Never expose passwordHash.
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          timezone: user.timezone,
        };
      },
    }),
  ],
});
