import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
    // Each database test file creates and migrates its own database.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
