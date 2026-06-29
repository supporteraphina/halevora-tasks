/**
 * Edge-safe Auth.js config — no Prisma, no bcrypt, no Node-only APIs.
 * Both `middleware.ts` (edge) and `src/auth.ts` (Node) build on THIS config. The full
 * config in `src/auth.ts` spreads this and adds the Credentials provider (Node only).
 *
 * Why split: NextAuth v5 + a database-backed Credentials provider can't run the
 * `authorize` logic on the edge. Route gating itself lives in `middleware.ts` (the
 * explicit `auth((req) => …)` form); here we only declare the session shape callbacks
 * so the middleware can read `req.auth` without dragging Prisma into the edge bundle.
 */
import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

export const authConfig = {
  // Self-hosted (not on Vercel): trust the deployment host. Without this, Auth.js v5
  // throws UntrustedHost in production (`npm start`), breaking login. Override the host
  // via AUTH_URL in production if it sits behind a proxy.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  // No providers here — declared in src/auth.ts (Credentials needs the Node runtime).
  providers: [],
  callbacks: {
    /** Carry id/role/timezone from the authorized user onto the JWT. */
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.timezone = user.timezone;
      }
      return token;
    },
    /** Expose id/role/timezone on the session for server + client reads. */
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.timezone = token.timezone as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
