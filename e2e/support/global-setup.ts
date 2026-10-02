import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Clears the API's rate-limit counters before a run. The suite submits
 * tickets and signs in from one address, so a second local run within the
 * hour would otherwise hit the per-address limits (NFR-9) and fail for a
 * reason that has nothing to do with the code under test. Only counters are
 * removed; no data is touched. Set E2E_KEEP_RATE_LIMITS=1 to skip.
 */
export default function globalSetup(): void {
  if (process.env.E2E_KEEP_RATE_LIMITS === "1") return;
  const script =
    "for k in $(redis-cli --scan --pattern 'dsd:rl:*'); do redis-cli del \"$k\" >/dev/null; done";
  const compose = path.resolve(import.meta.dirname, "../../compose.yaml");
  execFileSync(
    "docker",
    ["compose", "-f", compose, "exec", "-T", "redis", "sh", "-c", script],
    {
      stdio: "inherit",
    },
  );
}
