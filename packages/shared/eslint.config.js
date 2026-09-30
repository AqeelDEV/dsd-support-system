import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/shared",
  tsconfigRootDir: import.meta.dirname,
});
