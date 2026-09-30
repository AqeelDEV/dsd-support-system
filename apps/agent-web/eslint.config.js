import { createConfig } from "@dsd/config/eslint";

export default createConfig({
  packageName: "@dsd/agent-web",
  tsconfigRootDir: import.meta.dirname,
  kind: "next",
});
