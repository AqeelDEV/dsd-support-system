import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

import { boundaryConfig } from "./boundaries.js";

/**
 * Rules that protect output encoding (NFR-7). React escapes text by default;
 * `dangerouslySetInnerHTML` is the one way around that, so it is banned
 * everywhere rather than reviewed case by case.
 *
 * @type {import("eslint").Linter.RulesRecord}
 */
export const securityRules = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
      message:
        "dangerouslySetInnerHTML is not allowed. Render text, or sanitise markdown into React elements.",
    },
  ],
};

/**
 * @typedef {"node" | "nestjs" | "next" | "react"} ConfigKind
 *
 * @typedef {object} ConfigOptions
 * @property {string} packageName The workspace's package name, used to look up its boundaries.
 * @property {string} tsconfigRootDir Usually `import.meta.dirname` of the calling config file.
 * @property {ConfigKind} [kind]
 * @property {string[]} [ignores]
 */

/**
 * The ESLint flat config for one workspace package.
 *
 * @param {ConfigOptions} options
 */
export function createConfig({
  packageName,
  tsconfigRootDir,
  kind = "node",
  ignores = [],
}) {
  const usesReact = kind === "next" || kind === "react";

  return defineConfig(
    {
      ignores: ["dist/", ".next/", "coverage/", "next-env.d.ts", ...ignores],
    },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: usesReact
          ? { ...globals.browser, ...globals.node }
          : globals.node,
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
          // Lets consistent-type-imports keep value imports that NestJS
          // needs at runtime for dependency injection.
          ...(kind === "nestjs"
            ? { emitDecoratorMetadata: true, experimentalDecorators: true }
            : {}),
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: "error",
      },
      rules: {
        eqeqeq: ["error", "always"],
        "no-console": "error",
        ...securityRules,
        "@typescript-eslint/ban-ts-comment": [
          "error",
          {
            "ts-expect-error": "allow-with-description",
            "ts-ignore": "allow-with-description",
            "ts-nocheck": true,
            minimumDescriptionLength: 10,
          },
        ],
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "separate-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/restrict-template-expressions": [
          "error",
          { allowNumber: true },
        ],
      },
    },
    boundaryConfig(packageName),
    kind === "nestjs"
      ? {
          rules: {
            // Nest modules are classes that exist only to carry a decorator.
            "@typescript-eslint/no-extraneous-class": [
              "error",
              { allowWithDecorator: true },
            ],
          },
        }
      : {},
    usesReact
      ? {
          files: ["**/*.tsx"],
          extends: [
            reactHooks.configs.flat.recommended,
            jsxA11y.flatConfigs.recommended,
          ],
        }
      : {},
    kind === "next"
      ? {
          extends: [nextPlugin.configs["core-web-vitals"]],
        }
      : {},
    {
      files: ["**/*.{js,mjs,cjs}"],
      extends: [tseslint.configs.disableTypeChecked],
    },
  );
}
