/**
 * Formats every staged file, then lints staged source files in the
 * workspaces. ESLint finds each file's own package config.
 */
export default {
  "*": "prettier --write --ignore-unknown",
  "{apps,packages}/**/*.{ts,tsx,js,mjs,cjs}": "eslint --fix --no-warn-ignored",
};
