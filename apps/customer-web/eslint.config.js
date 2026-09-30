import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/customer-web",
  tsconfigRootDir: import.meta.dirname,
  kind: "next",
});
