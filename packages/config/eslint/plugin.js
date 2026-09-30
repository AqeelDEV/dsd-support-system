import path from "node:path";

import { WORKSPACES } from "./workspaces.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

/**
 * The workspace directory that contains `file`, if any.
 *
 * @param {string} file Absolute path.
 */
function workspaceOf(file) {
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  return Object.values(WORKSPACES).find(
    ({ dir }) => relative === dir || relative.startsWith(`${dir}/`),
  )?.dir;
}

/**
 * Resolves each relative import against the importing file and reports it
 * when it lands in a different workspace. A pattern match on the specifier
 * can't do this reliably, because how many `../` segments leave a workspace
 * depends on how deep the importing file is.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
const noCrossWorkspaceRelativeImport = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow relative imports that reach into another workspace package",
    },
    messages: {
      crossWorkspace:
        "Relative import reaches from {{from}} into {{to}}. Import the package by name, if the dependency rules allow it (see docs/adr/0002-monorepo-layout.md).",
    },
    schema: [],
  },
  create(context) {
    const from = workspaceOf(context.filename);
    if (!from) return {};

    /** @param {import("eslint").Rule.Node} node */
    function check(node) {
      const source = "source" in node ? node.source : null;
      if (source?.type !== "Literal" || typeof source.value !== "string")
        return;
      if (!source.value.startsWith(".")) return;
      const target = path.resolve(path.dirname(context.filename), source.value);
      const to = workspaceOf(target) ?? "outside every workspace";
      if (to !== from) {
        context.report({
          node: source,
          messageId: "crossWorkspace",
          data: { from, to },
        });
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

/** @type {import("eslint").ESLint.Plugin} */
export const dsdPlugin = {
  meta: { name: "@dsd/eslint-plugin" },
  rules: {
    "no-cross-workspace-relative-import": noCrossWorkspaceRelativeImport,
  },
};
