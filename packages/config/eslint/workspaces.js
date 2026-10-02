/**
 * The workspace packages and which internal packages each may import
 * (ADR-0002). Kept as data so the lint rules, their tests and the ADR can be
 * compared line by line.
 */

/**
 * @typedef {object} Workspace
 * @property {string} dir Path from the repository root.
 * @property {readonly string[]} allow Internal packages it may import.
 */

/** @type {Readonly<Record<string, Workspace>>} */
export const WORKSPACES = Object.freeze({
  "@dsd/api": { dir: "apps/api", allow: ["@dsd/shared", "@dsd/db"] },
  "@dsd/worker": { dir: "apps/worker", allow: ["@dsd/shared", "@dsd/db"] },
  "@dsd/customer-web": {
    dir: "apps/customer-web",
    allow: ["@dsd/shared", "@dsd/api-client", "@dsd/ui"],
  },
  "@dsd/agent-web": {
    dir: "apps/agent-web",
    allow: ["@dsd/shared", "@dsd/api-client", "@dsd/ui"],
  },
  "@dsd/shared": { dir: "packages/shared", allow: [] },
  "@dsd/api-client": { dir: "packages/api-client", allow: [] },
  // The database package reuses the enum values defined once in shared.
  "@dsd/db": { dir: "packages/db", allow: ["@dsd/shared"] },
  "@dsd/ui": { dir: "packages/ui", allow: ["@dsd/shared"] },
  "@dsd/config": { dir: "packages/config", allow: [] },
  // Browser tests drive the running apps from outside, like a user would.
  "@dsd/e2e": { dir: "e2e", allow: [] },
});
