/**
 * Liveness / keep-warm endpoint. Returns instantly with NO database or auth work, so an
 * uptime monitor or cron can ping it cheaply to keep the instance warm (avoiding the
 * multi-second cold start that follows an idle period) and to health-check the deploy.
 *
 * Public by design — it exposes nothing. Route protection (src/proxy.ts) allows /api/*.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, service: "halevora-tasks", at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
