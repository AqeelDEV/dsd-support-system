import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/api",
  tsconfigRootDir: import.meta.dirname,
  kind: "nestjs",
});
