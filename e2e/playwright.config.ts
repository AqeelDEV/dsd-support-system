import { defineConfig, devices } from "@playwright/test";

import { CUSTOMER_URL } from "./support/env";

/*
 * End-to-end tests drive the real apps on the Compose stack (`docker compose
 * up --build --wait`), with the seeded demo data and Mailpit for email.
 * Every test makes its own customers with unique addresses, so tests don't
 * depend on each other or on the order they run in.
 */
export default defineConfig({
  testDir: ".",
  globalSetup: "./support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  workers: process.env.CI === undefined ? 4 : 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter:
    process.env.CI === undefined
      ? "list"
      : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: CUSTOMER_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: ["**/screenshots.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "screenshots",
      testMatch: ["**/screenshots.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
