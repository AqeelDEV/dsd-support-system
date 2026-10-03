import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config.js";

/**
 * `pnpm --filter @dsd/api perf`: the NFR-1 measurement alone, with a larger
 * sample than `pnpm test` takes, for the numbers docs/PERFORMANCE.md records.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["test/performance/**/*.spec.ts"],
      env: { NFR1_SAMPLES: "100" },
    },
  }),
);
