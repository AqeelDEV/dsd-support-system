import { createConfig } from "./eslint/index.js";

export default createConfig({
  packageName: "@dsd/config",
  tsconfigRootDir: import.meta.dirname,
});
