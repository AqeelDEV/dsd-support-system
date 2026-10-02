import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { request } from "@playwright/test";

import { AGENT_URL, DEMO } from "./env";
import { STAFF_ROLES, staffState } from "./staff";

/**
 * Runs once before the browser tests.
 *
 * 1. Clears the API's rate-limit counters. The suite submits tickets and
 *    signs in from one address, so a second local run within the hour would
 *    otherwise hit the per-address limits (NFR-9) and fail for a reason
 *    that has nothing to do with the code under test. Only counters are
 *    removed; no data is touched. Set E2E_KEEP_RATE_LIMITS=1 to skip.
 * 2. Signs each demo staff role in once and saves the cookies, so staff
 *    tests start signed in and stay well under the per-email sign-in limit.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_KEEP_RATE_LIMITS !== "1") {
    const script =
      "for k in $(redis-cli --scan --pattern 'dsd:rl:*'); do redis-cli del \"$k\" >/dev/null; done";
    const compose = path.resolve(import.meta.dirname, "../../compose.yaml");
    execFileSync(
      "docker",
      ["compose", "-f", compose, "exec", "-T", "redis", "sh", "-c", script],
      { stdio: "inherit" },
    );
  }

  mkdirSync(path.dirname(staffState("agent")), { recursive: true });
  for (const role of STAFF_ROLES) {
    const api = await request.newContext({ baseURL: AGENT_URL });
    const response = await api.post("/api/v1/auth/staff/login", {
      data: { email: DEMO[role], password: DEMO.password },
      headers: { origin: AGENT_URL },
    });
    if (!response.ok()) {
      throw new Error(
        `Signing in as the demo ${role} failed: ${String(response.status())}`,
      );
    }
    await api.storageState({ path: staffState(role) });
    await api.dispose();
  }
}
