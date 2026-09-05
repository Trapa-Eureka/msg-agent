import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/core/**"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      // SPEC §7 / T10: src/core must stay at or above 90% — `npm run check` fails otherwise.
      thresholds: { statements: 90, lines: 90, functions: 90, branches: 80 },
    },
  },
});
