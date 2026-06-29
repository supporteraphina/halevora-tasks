/**
 * Route protection (Next.js 16 "proxy" convention — the renamed successor to
 * "middleware"). Runs on the edge for every matched request.
 *
 * We use the explicit `auth((req) => …)` wrapper so the gate logic is deterministic:
 * `req.auth` is the session (or null). Unauthenticated requests to app routes are sent
 * to /login; already-signed-in users are bounced off /login to the board.
 *
 * Edge-safe: imports only the providerless config (no Prisma/bcrypt). CEO-only checks
 * live in the page/server-action layer (this proxy only enforces "signed in").
 */
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PREFIXES = ["/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth?.user;

  if (isPublicPath(nextUrl.pathname)) {
    // Keep signed-in users out of the login page.
    if (isLoggedIn) {
      return Response.redirect(new URL("/board", nextUrl));
    }
    return; // allow
  }

  // Every other matched route requires a session.
  if (!isLoggedIn) {
    return Response.redirect(new URL("/login", nextUrl));
  }

  return; // allow
});

export const config = {
  // Run on everything except Next internals, the auth API, and static assets.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
