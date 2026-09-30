import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/ui",
  tsconfigRootDir: import.meta.dirname,
  kind: "react",
});
