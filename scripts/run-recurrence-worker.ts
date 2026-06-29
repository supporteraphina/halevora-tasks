/**
 * CLI entry for the scheduled recurrence worker. Run a single pass:
 *
 *   npm run recur:worker
 *
 * Intended to be invoked by a cron / scheduled job. It runs WITHOUT a session as a trusted
 * system actor (see src/lib/recurrenceWorker.ts). Exits non-zero if any rule errored so a
 * scheduler can surface failures.
 */
import "dotenv/config";
import { runScheduledRecurrences } from "../src/lib/recurrenceWorker";

async function main() {
  const result = await runScheduledRecurrences();
  console.log(
    `[recur:worker] scanned=${result.scanned} spawned=${result.spawned}` +
      (result.spawnedTaskIds.length
        ? ` new=${result.spawnedTaskIds.join(",")}`
        : ""),
  );
  if (result.errors.length) {
    for (const e of result.errors) {
      console.error(`[recur:worker] error task=${e.taskId}: ${e.message}`);
    }
    process.exitCode = 1;
  }
}

main()
  .then(async () => {
    const { default: prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    const { default: prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
    process.exit(1);
  });
