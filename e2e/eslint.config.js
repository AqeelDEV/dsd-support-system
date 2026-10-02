import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/e2e",
  tsconfigRootDir: import.meta.dirname,
});
