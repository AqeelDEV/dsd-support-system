import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/worker",
  tsconfigRootDir: import.meta.dirname,
});
