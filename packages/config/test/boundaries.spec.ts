import path from "node:path";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import {
  boundaryConfig,
  boundaryRules,
  WORKSPACES,
} from "../eslint/boundaries.js";
import { createConfig, securityRules } from "../eslint/index.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

/**
 * Lints a snippet as if it were a file in `packageName`, using the same
 * boundary config the real per-package configs use. Type-aware rules are
 * left out on purpose: they need files on disk, and they aren't under test.
 */
async function lint(
  packageName: string,
  code: string,
  fileInPackage = "src/feature/example.tsx",
) {
  const workspace = WORKSPACES[packageName];
  if (!workspace) throw new Error(`unknown package ${packageName}`);
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: securityRules,
      },
      { files: ["**/*.ts", "**/*.tsx"], ...boundaryConfig(packageName) },
    ],
  });
  const filePath = path.join(repoRoot, workspace.dir, fileInPackage);
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId);
}

describe("workspace boundaries (ADR-0002)", () => {
  it.each([
    [
      "@dsd/customer-web",
      'import { createDb } from "@dsd/db";',
      "no-restricted-imports",
    ],
    [
      "@dsd/agent-web",
      'import { tickets } from "@dsd/db/schema";',
      "no-restricted-imports",
    ],
    ["@dsd/api", 'import { Button } from "@dsd/ui";', "no-restricted-imports"],
    [
      "@dsd/worker",
      'import { x } from "@dsd/api-client/proxy";',
      "no-restricted-imports",
    ],
    [
      "@dsd/shared",
      'import { createDb } from "@dsd/db";',
      "no-restricted-imports",
    ],
    [
      "@dsd/ui",
      'import { createApiClient } from "@dsd/api-client";',
      "no-restricted-imports",
    ],
    [
      "@dsd/api",
      'import { x } from "@dsd/shared/src/problem-details.js";',
      "no-restricted-imports",
    ],
    [
      "@dsd/api",
      'import { createDb } from "../../../../packages/db/src/index.js";',
      "dsd/no-cross-workspace-relative-import",
    ],
    [
      "@dsd/customer-web",
      'import { thing } from "../../../agent-web/src/thing";',
      "dsd/no-cross-workspace-relative-import",
    ],
    [
      "@dsd/worker",
      'export { handler } from "../../../api/src/handler.js";',
      "dsd/no-cross-workspace-relative-import",
    ],
  ])("%s: rejects %s", async (packageName, code, rule) => {
    expect(await lint(packageName, code)).toContain(rule);
  });

  it.each([
    ["@dsd/api", 'import { createDb } from "@dsd/db";'],
    ["@dsd/api", 'import { problemDetailsSchema } from "@dsd/shared";'],
    ["@dsd/worker", 'import { createPool } from "@dsd/db";'],
    ["@dsd/customer-web", 'import { Button } from "@dsd/ui";'],
    [
      "@dsd/customer-web",
      'import { createApiProxy } from "@dsd/api-client/proxy";',
    ],
    ["@dsd/db", 'import { TICKET_STATUSES } from "@dsd/shared";'],
    ["@dsd/api", 'import { createConfig } from "@dsd/config/eslint";'],
    ["@dsd/api", 'import { helper } from "../../common/helper.js";'],
    [
      "@dsd/api",
      'import packageJson from "../../package.json" with { type: "json" };',
    ],
  ])("%s: allows %s", async (packageName, code) => {
    expect(await lint(packageName, code)).toEqual([]);
  });

  it("refuses to build rules for a package missing from the table", () => {
    expect(() => boundaryRules("@dsd/unknown")).toThrow(
      /not in the workspace boundary table/,
    );
  });

  it("maps every workspace to its own directory", () => {
    const dirs = Object.values(WORKSPACES).map((workspace) => workspace.dir);
    expect(new Set(dirs).size).toBe(dirs.length);
  });
});

describe("output encoding (NFR-7)", () => {
  it("bans dangerouslySetInnerHTML", async () => {
    const code =
      "export const A = () => <div dangerouslySetInnerHTML={{ __html: x }} />;";
    expect(await lint("@dsd/customer-web", code)).toContain(
      "no-restricted-syntax",
    );
  });
});

describe("createConfig", () => {
  it("applies the package's boundary and security rules to its source files", async () => {
    const eslint = new ESLint({
      cwd: import.meta.dirname,
      overrideConfigFile: true,
      overrideConfig: createConfig({
        packageName: "@dsd/customer-web",
        tsconfigRootDir: import.meta.dirname,
        kind: "next",
      }),
    });
    const config = (await eslint.calculateConfigForFile("src/page.tsx")) as {
      rules: Record<string, [number, ...unknown[]]>;
    };
    const [, expectedImports] = boundaryRules("@dsd/customer-web")[
      "no-restricted-imports"
    ] as [string, unknown];
    const [, expectedSyntax] = securityRules["no-restricted-syntax"] as [
      string,
      unknown,
    ];

    expect(config.rules["no-restricted-imports"]).toEqual([2, expectedImports]);
    expect(config.rules["dsd/no-cross-workspace-relative-import"]).toEqual([2]);
    expect(config.rules["no-restricted-syntax"]).toEqual([2, expectedSyntax]);
  });
});
