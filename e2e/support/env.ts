import { randomUUID } from "node:crypto";

import type { Browser, BrowserContext } from "@playwright/test";

/*
 * Where the stack is. 127.0.0.1 rather than localhost: on some machines
 * localhost resolves to ::1 first, where another program may listen, and
 * cookies are kept per host name, so every test uses the same one.
 */
export const CUSTOMER_URL =
  process.env.E2E_CUSTOMER_URL ?? "http://127.0.0.1:3000";
export const AGENT_URL = process.env.E2E_AGENT_URL ?? "http://127.0.0.1:3001";
export const MAILPIT_URL =
  process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";

/** The seeded demo accounts (packages/db seed). */
export const DEMO = {
  password: "dsd-demo-password",
  customer: "customer@example.com",
  agent: "agent@dsd.example",
  supervisor: "supervisor@dsd.example",
  admin: "admin@dsd.example",
} as const;

/** A fresh address for one test, so per-email rate limits and old emails never interfere. */
export const uniqueEmail = (label: string) =>
  `e2e-${label}-${randomUUID().slice(0, 8)}@example.com`;

/**
 * A browser with no cookies at all. `browser.newContext()` inside a test
 * inherits the file's `use` options, staff session included, so a "new"
 * visitor must say explicitly that they have none.
 */
export const freshContext = (
  browser: Browser,
  baseURL: string,
): Promise<BrowserContext> =>
  browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
