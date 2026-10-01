import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
    // Integration tests run beside the API's in CI and locally; creating and
    // seeding a database each takes a while under that load.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
