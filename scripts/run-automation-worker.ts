/**
 * CLI entry for the scheduled automation worker. Run a single pass:
 *
 *   npm run automation:worker
 *
 * Intended to be invoked by a cron / scheduled job. It runs WITHOUT a session as a trusted
 * system actor (see src/lib/automationWorker.ts). Exits non-zero if any rule errored so a
 * scheduler can surface failures.
 */
import "dotenv/config";
import { runScheduledAutomations } from "../src/lib/automationWorker";

async function main() {
  const result = await runScheduledAutomations();
  console.log(
    `[automation:worker] scanned=${result.scanned} fired=${result.fired} applied=${result.applied}`,
  );
  if (result.errors.length) {
    for (const e of result.errors) {
      console.error(`[automation:worker] error rule=${e.ruleId}: ${e.message}`);
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
