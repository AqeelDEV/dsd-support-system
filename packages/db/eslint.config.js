import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/db",
  tsconfigRootDir: import.meta.dirname,
});
