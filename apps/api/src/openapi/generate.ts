import "reflect-metadata";

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createApp } from "../app.factory.js";
import { parseEnv } from "../config/env.js";
import { buildOpenApiDocument } from "./document.js";

/**
 * Writes openapi.json at the package root. The document depends only on
 * the code, so placeholder connection settings are used; the app is built
 * but never initialised, so nothing connects to them.
 */
const OUTPUT = fileURLToPath(new URL("../../openapi.json", import.meta.url));

const env = parseEnv({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://openapi@127.0.0.1:1/openapi",
  REDIS_URL: "redis://127.0.0.1:1",
  TRUSTED_ORIGINS: "https://support.dsd.example",
  AUTH_SECRET: "openapi-generation-only-placeholder-secret",
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_ACCESS_KEY_ID: "openapi",
  S3_SECRET_ACCESS_KEY: "openapi",
});
const app = await createApp(env);
// The committed document describes a production deployment: secure cookies.
const document = buildOpenApiDocument(app, env.COOKIE_SECURE);
await writeFile(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
await app.close();
process.stdout.write(`Wrote ${OUTPUT}\n`);
