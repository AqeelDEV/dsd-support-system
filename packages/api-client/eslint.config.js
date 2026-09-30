import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/api-client",
  tsconfigRootDir: import.meta.dirname,
  // Generated from the API's OpenAPI document.
  ignores: ["src/schema.d.ts"],
});
