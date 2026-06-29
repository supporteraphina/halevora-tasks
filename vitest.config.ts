import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig `@/*` -> `src/*` path alias so lib tests (which import server
      // glue using the alias, e.g. `@/lib/prisma`) resolve under vitest too.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Unit/domain tests only. Playwright owns e2e/ (run via `npm run test:e2e`).
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
