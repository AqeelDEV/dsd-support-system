/**
 * Workspace dependency boundaries (ADR-0002).
 *
 * pnpm's strict node_modules layout already stops an undeclared import from
 * resolving. These rules are the second line: they fail the lint even when
 * someone adds the dependency to package.json, and they catch deep imports
 * into another package's internals and relative paths that escape a
 * workspace.
 */

import { dsdPlugin } from "./plugin.js";
import { WORKSPACES } from "./workspaces.js";

export { WORKSPACES };

/** Tooling presets every workspace may use in its own config files. */
const ALWAYS_ALLOWED = new Set(["@dsd/config"]);

/**
 * The `no-restricted-imports` rule for one workspace. ESLint doesn't merge
 * options for the same rule across config objects, so every import
 * restriction for a workspace is built here, in one place.
 *
 * @param {string} packageName
 * @returns {import("eslint").Linter.RulesRecord}
 */
export function boundaryRules(packageName) {
  const workspace = WORKSPACES[packageName];
  if (!workspace) {
    throw new Error(
      `${packageName} is not in the workspace boundary table. Add it to WORKSPACES in @dsd/config/eslint/workspaces.js.`,
    );
  }

  const forbidden = Object.keys(WORKSPACES).filter(
    (name) =>
      name !== packageName &&
      !ALWAYS_ALLOWED.has(name) &&
      !workspace.allow.includes(name),
  );
  /** @param {string} name */
  const reason = (name) =>
    `${packageName} must not depend on ${name} (see docs/adr/0002-monorepo-layout.md).`;

  /** @type {Array<Record<string, unknown>>} */
  const patterns = [
    {
      regex: "^@dsd/[^/]+/src(/|$)",
      message:
        "Import a workspace package through its entry point, not its src/ internals.",
    },
  ];
  if (forbidden.length > 0) {
    patterns.push({
      group: forbidden.map((name) => `${name}/*`),
      message: `${packageName} must not depend on this package (see docs/adr/0002-monorepo-layout.md).`,
    });
  }

  return {
    "no-restricted-imports": [
      "error",
      {
        paths: forbidden.map((name) => ({ name, message: reason(name) })),
        patterns,
      },
    ],
  };
}

/**
 * Everything that enforces one workspace's boundaries, as a config object.
 *
 * @param {string} packageName
 * @returns {import("eslint").Linter.Config}
 */
export function boundaryConfig(packageName) {
  return {
    plugins: { dsd: dsdPlugin },
    rules: {
      ...boundaryRules(packageName),
      "dsd/no-cross-workspace-relative-import": "error",
    },
  };
}
