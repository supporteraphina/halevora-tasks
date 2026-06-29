/**
 * HTTP trigger for the scheduled recurrence worker (ON_SCHEDULE). A cron service can hit
 * this on an interval; it runs the same reusable `runScheduledRecurrences` single-pass as
 * the `npm run recur:worker` CLI.
 *
 * AUTH: the worker is a trusted system action, so this endpoint is NOT row-scoped. It is
 * gated two ways:
 *   - a `Bearer ${CRON_SECRET}` header (for an external scheduler), when CRON_SECRET is set;
 *   - OR a signed-in CEO session (so an admin can run it manually from the app/host).
 * If CRON_SECRET is unset, only the CEO-session path is accepted (never open to the world).
 */
import { NextResponse } from "next/server";
import { runScheduledRecurrences } from "@/lib/recurrenceWorker";
import { currentActor } from "@/lib/scope";

export const dynamic = "force-dynamic";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header === `Bearer ${secret}`) return true;
  }
  // Fall back to a signed-in CEO (manual run). Members may never trigger the worker.
  const actor = await currentActor();
  return actor?.role === "CEO";
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runScheduledRecurrences();
  return NextResponse.json(result);
}

// Allow GET too (some schedulers only issue GET), behind the same authorization.
export async function GET(req: Request) {
  return POST(req);
}
