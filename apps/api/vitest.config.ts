import { defineConfig } from "vitest/config";

export default defineConfig({
  // NestJS resolves constructor dependencies from decorator metadata, so the
  // test transform must compile legacy decorators and emit that metadata,
  // as tsc does for the build.
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
    setupFiles: ["reflect-metadata"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
