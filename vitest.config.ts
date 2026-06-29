import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit/domain tests only. Playwright owns e2e/ (run via `npm run test:e2e`).
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
